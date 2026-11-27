import 'dotenv/config';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getEnv, isVercelBlobConfigured } from './src/config/env.js';
import {
  buildSessionClearCookie,
  buildSessionSetCookie,
  createSessionToken,
  parseSessionCookie,
  verifyCredentials,
  type AuthUser,
} from './src/core/auth/session.js';
import { getAppContainer } from './src/core/container.js';
import { getUpcomingScheduleRuns } from './src/core/domain/schedule.js';
import type { DashboardSnapshot, YouTubeChannelConnection } from './src/core/domain/types.js';
import {
  createYouTubeOAuthClient,
  exchangeYouTubeAuthCode,
  isYouTubeOAuthConfigured,
  resolveYouTubeRedirectUri,
  YOUTUBE_OAUTH_SCOPES,
} from './src/core/providers/publisher/youtube-publisher.js';
import { isAllowedVercelBlobUrl } from './src/core/providers/storage/vercel-blob-storage.js';
import { probeVideoDurationSec } from './src/core/providers/video/ffmpeg-media.js';

const env = getEnv();
const PORT = env.PORT;
const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv']);
const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/x-matroska',
];
const THUMBNAIL_POOL = [
  '/src/assets/images/goal_top_corner_volley_1795253540408.jpg',
  '/src/assets/images/goal_freekick_curler_1795253539982.jpg',
  '/src/assets/images/goal_counter_breakaway_1795253540648.jpg',
];

const registerBlobClipSchema = z.object({
  blobUrl: z.string().url().refine(isAllowedVercelBlobUrl, 'Must be a valid Vercel Blob URL.'),
  blobPathname: z.string().min(1).max(300),
  originalFilename: z.string().min(1).max(160),
  fileSizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
  durationSec: z.number().min(0.5).max(30).optional().default(6.0),
  mimeType: z.string().min(1).max(80).default('video/mp4'),
});

let pipelineInFlight = false;

// Stateless HMAC-signed OAuth state so it survives across serverless instances.
function oauthStateKey(): string {
  return process.env.YOUTUBE_CLIENT_SECRET?.trim() || 'goalcast-dev-state-key';
}

function signOAuthPayload(payload: string): string {
  return crypto.createHmac('sha256', oauthStateKey()).update(payload).digest('hex');
}

function issueOAuthState(): string {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const payload = `${crypto.randomBytes(12).toString('hex')}.${expiresAt}`;
  return `${payload}.${signOAuthPayload(payload)}`;
}

function consumeOAuthState(state: string): boolean {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, expiresAtRaw, signature] = parts;
  const expected = signOAuthPayload(`${nonce}.${expiresAtRaw}`);
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(expiresAtRaw) >= Date.now();
}

function sanitizeFilename(rawName: string): string {
  const base = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 120) || 'goal_clip.mp4';
}

function pickThumbnailForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return THUMBNAIL_POOL[hash % THUMBNAIL_POOL.length];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function buildDashboardSnapshot(): Promise<DashboardSnapshot> {
  const container = getAppContainer();
  const [clips, tokens] = await Promise.all([
    container.queueRepo.listClips(),
    container.channelRepo.getTokens(),
  ]);

  const channel: YouTubeChannelConnection = {
    connected: Boolean(tokens),
    channelId: tokens?.channelId ?? null,
    channelTitle: tokens?.channelTitle ?? null,
    channelHandle: tokens?.channelHandle ?? null,
    channelThumbnailUrl: tokens?.channelThumbnailUrl ?? null,
    connectedAt: tokens?.connectedAt ?? null,
    oauthConfigured: isYouTubeOAuthConfigured(),
  };

  const nextRun = getUpcomingScheduleRuns(new Date(), 1)[0];

  return {
    clips,
    channel,
    uploadMode: isVercelBlobConfigured() ? 'vercel-blob' : 'local-preview',
    nextRunIso: nextRun.toISOString(),
  };
}

export function createApiApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 20,
    },
  });

  const isSecureCookieRequest = (req: express.Request): boolean =>
    req.secure || req.headers['x-forwarded-proto'] === 'https' || Boolean(process.env.VERCEL);

  const getSessionUser = (req: express.Request): AuthUser | null =>
    parseSessionCookie(req.headers.cookie);

  const requireAuth = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const user = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    res.locals.user = user;
    next();
  };

  const requireAdmin = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const user = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    if (user.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required for test pipeline inspection.' });
      return;
    }
    res.locals.user = user;
    next();
  };

  // 0. Session Authentication (Production User & Admin Test User)
  app.get('/api/auth/me', (req, res) => {
    const user = getSessionUser(req);
    res.json({ authenticated: Boolean(user), user });
  });

  app.post('/api/auth/login', (req, res) => {
    const loginSchema = z.object({
      username: z.string().min(1).max(80),
      password: z.string().min(1).max(200),
    });
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter both username and password.' });
      return;
    }

    const user = verifyCredentials(parsed.data.username, parsed.data.password);
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password. Contact Abdul Ahad for access.' });
      return;
    }

    const token = createSessionToken(user);
    res.setHeader('Set-Cookie', buildSessionSetCookie(token, isSecureCookieRequest(req)));
    res.json({ authenticated: true, user });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', buildSessionClearCookie(isSecureCookieRequest(req)));
    res.json({ ok: true });
  });

  // 1. Minimal dashboard snapshot
  app.get('/api/dashboard', requireAuth, async (_req, res) => {
    try {
      const snapshot = await buildDashboardSnapshot();
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load backlog.',
      });
    }
  });

  // 2. Vercel Blob Client Upload handshake endpoint (bypasses Vercel 4.5 MB serverless limit)
  app.post('/api/upload', async (req, res) => {
    const body = req.body as HandleUploadBody;
    // Browser token generation requires an authenticated user; Vercel's signed upload-completed webhook does not carry cookies.
    if (body?.type !== 'blob.upload-completed' && !getSessionUser(req)) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }

    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token) {
      res.status(400).json({
        error: 'Vercel Blob is not configured on this server.',
      });
      return;
    }

    try {
      const jsonResponse = await handleUpload({
        body,
        request: req,
        token,
        onBeforeGenerateToken: async (_pathname) => ({
          allowedContentTypes: ALLOWED_VIDEO_MIME_TYPES,
          maximumSizeInBytes: 50 * 1024 * 1024,
          addRandomSuffix: true,
        }),
        onUploadCompleted: async ({ blob }) => {
          console.log('[GoalCast Blob] Client upload completed:', blob.pathname);
        },
      });
      res.json(jsonResponse);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Could not authorize Vercel Blob upload.',
      });
    }
  });

  // 3. Persist completed Vercel Blob client upload as a PENDING job in Neon PostgreSQL
  app.post('/api/clips/register', requireAuth, async (req, res) => {
    try {
      const parsed = registerBlobClipSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid uploaded clip metadata.',
        });
        return;
      }

      const container = getAppContainer();
      const clipId = `clip-${crypto.randomUUID().slice(0, 8)}`;
      const safeName = sanitizeFilename(parsed.data.originalFilename);

      const created = await container.queueRepo.createClip({
        id: clipId,
        originalFilename: safeName,
        blobUrl: parsed.data.blobUrl,
        blobPathname: parsed.data.blobPathname,
        fileSizeBytes: parsed.data.fileSizeBytes,
        durationSec: parsed.data.durationSec,
        mimeType: parsed.data.mimeType,
        thumbnailUrl: pickThumbnailForId(clipId),
      });

      const snapshot = await buildDashboardSnapshot();
      res.status(201).json({ clip: created, snapshot });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to queue uploaded clip.',
      });
    }
  });

  // 4. Local preview multipart upload fallback (used when BLOB_READ_WRITE_TOKEN is unset)
  app.post('/api/clips/upload', requireAuth, upload.array('files', 20), async (req, res) => {
    try {
      const uploadedFiles = req.files as Express.Multer.File[] | undefined;
      if (!uploadedFiles || uploadedFiles.length === 0) {
        res.status(400).json({ error: 'Please select at least one football video clip.' });
        return;
      }

      const container = getAppContainer();
      const createdClips = [];

      for (const file of uploadedFiles) {
        const ext = path.extname(file.originalname).toLowerCase();
        const isVideoMime = file.mimetype.startsWith('video/');
        if (!isVideoMime && !ALLOWED_VIDEO_EXTENSIONS.has(ext)) {
          res.status(400).json({
            error: `Unsupported file "${file.originalname}". Upload MP4, MOV, or WebM clips.`,
          });
          return;
        }

        const clipId = `clip-${crypto.randomUUID().slice(0, 8)}`;
        const safeName = sanitizeFilename(file.originalname);
        const pathname = `clips/${clipId}/${safeName}`;

        let durationSec = 6.0;
        const tempFile = path.join(os.tmpdir(), `probe-${clipId}${ext || '.mp4'}`);
        try {
          await fs.writeFile(tempFile, file.buffer);
          const probed = await probeVideoDurationSec(tempFile);
          if (probed !== null) durationSec = probed;
        } catch {
          durationSec = 6.0;
        } finally {
          await fs.unlink(tempFile).catch(() => {});
        }

        const uploaded = await container.storage.uploadBuffer(
          pathname,
          file.buffer,
          file.mimetype || 'video/mp4'
        );

        const created = await container.queueRepo.createClip({
          id: clipId,
          originalFilename: safeName,
          blobUrl: uploaded.url,
          blobPathname: uploaded.pathname,
          fileSizeBytes: file.size,
          durationSec,
          mimeType: file.mimetype || 'video/mp4',
          thumbnailUrl: pickThumbnailForId(clipId),
        });
        createdClips.push(created);
      }

      const snapshot = await buildDashboardSnapshot();
      res.status(201).json({
        uploadedCount: createdClips.length,
        clips: createdClips,
        snapshot,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Upload failed.',
      });
    }
  });

  // 5. Retry a failed clip
  app.post('/api/clips/:id/retry', requireAuth, async (req, res) => {
    try {
      const clipId = String(req.params.id || '').trim();
      const container = getAppContainer();
      const updated = await container.queueRepo.retryClip(clipId);
      if (!updated) {
        res.status(404).json({ error: 'Failed clip not found.' });
        return;
      }
      const snapshot = await buildDashboardSnapshot();
      res.json({ clip: updated, snapshot });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not retry clip.',
      });
    }
  });

  // 6. Delete a pending, ready_for_review, or failed clip from backlog & storage
  app.delete('/api/clips/:id', requireAuth, async (req, res) => {
    try {
      const clipId = String(req.params.id || '').trim();
      const container = getAppContainer();
      const existing = await container.queueRepo.getClipById(clipId);
      if (!existing) {
        res.status(404).json({ error: 'Clip not found.' });
        return;
      }
      if (existing.status === 'processing') {
        res.status(409).json({ error: 'Cannot delete a clip while it is processing.' });
        return;
      }

      const deleteTargets = new Set<string>([existing.blobUrl]);
      if (existing.renderedVideoUrl) deleteTargets.add(existing.renderedVideoUrl);
      const variantsMatch = /\[variants:(\{[^\n]*\})\]/i.exec(existing.commentaryScript || '');
      if (variantsMatch) {
        try {
          const map = JSON.parse(variantsMatch[1]) as Record<string, string>;
          for (const url of Object.values(map)) {
            if (url) deleteTargets.add(url);
          }
        } catch {
          // Ignore malformed variant metadata
        }
      }

      await Promise.allSettled(
        Array.from(deleteTargets).map((target) => container.storage.deleteObject(target))
      );
      await container.queueRepo.deleteClip(clipId);
      const snapshot = await buildDashboardSnapshot();
      res.json({ deletedId: clipId, snapshot });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to delete clip.',
      });
    }
  });

  // 6b. Stream rendered final Short (or raw source) for admin test preview
  app.get('/api/clips/:id/preview', requireAdmin, async (req, res) => {
    try {
      const clipId = String(req.params.id || '').trim();
      const container = getAppContainer();
      const clip = await container.queueRepo.getClipById(clipId);
      if (!clip) {
        res.status(404).json({ error: 'Clip not found.' });
        return;
      }

      const sourceMode = req.query.source === 'raw' ? 'raw' : 'rendered';
      const targetUrl =
        sourceMode === 'raw' ? clip.blobUrl : clip.renderedVideoUrl || clip.blobUrl;

      if (targetUrl.startsWith('https://') || targetUrl.startsWith('http://')) {
        res.redirect(302, targetUrl);
        return;
      }

      const localPath = container.storage.resolveLocalFilePath?.(targetUrl) ?? null;
      if (!localPath) {
        res.status(404).json({ error: 'Preview video file is unavailable.' });
        return;
      }

      const stat = await fs.stat(localPath).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.status(404).json({ error: 'Preview video file not found on disk.' });
        return;
      }

      const fileSize = stat.size;
      const contentType =
        sourceMode === 'raw' ? clip.mimeType || 'video/mp4' : 'video/mp4';
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
        if (!match) {
          res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
          return;
        }
        const start = Number.parseInt(match[1], 10);
        const rawEnd = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
        const end = Math.min(rawEnd, fileSize - 1);
        if (start >= fileSize || start > end) {
          res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
          return;
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        });
        fsSync.createReadStream(localPath, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      });
      fsSync.createReadStream(localPath).pipe(res);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to stream preview video.',
      });
    }
  });

  // 6c. Manual approval gate (Admin Test Pipeline): publish a ready_for_review Short to YouTube
  app.post('/api/clips/:id/approve', requireAdmin, async (req, res) => {
    if (pipelineInFlight) {
      res.status(409).json({ error: 'Another clip job is currently in progress.' });
      return;
    }

    pipelineInFlight = true;
    try {
      const clipId = String(req.params.id || '').trim();
      const container = getAppContainer();
      const outcome = await container.orchestrator.approveAndPublishClip(clipId);
      const snapshot = await buildDashboardSnapshot();
      res.json({ ...outcome, snapshot });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to approve and upload clip.',
      });
    } finally {
      pipelineInFlight = false;
    }
  });

  // 6d. Re-roll crowd audio & re-render (Admin Test Pipeline)
  app.post('/api/clips/:id/rerender', requireAdmin, async (req, res) => {
    try {
      const clipId = String(req.params.id || '').trim();
      const container = getAppContainer();
      const existing = await container.queueRepo.getClipById(clipId);
      if (!existing) {
        res.status(404).json({ error: 'Clip not found.' });
        return;
      }
      if (existing.renderedVideoUrl) {
        await container.storage.deleteObject(existing.renderedVideoUrl).catch(() => {});
      }
      const updated = await container.queueRepo.requeueClip(clipId);
      if (!updated) {
        res.status(400).json({ error: 'Only failed or ready-for-review clips can be re-queued.' });
        return;
      }
      const snapshot = await buildDashboardSnapshot();
      res.json({ clip: updated, snapshot });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not requeue clip for re-render.',
      });
    }
  });

  // 6e. List saved audio preview variants for a clip (Admin Test Pipeline)
  app.get('/api/clips/:id/variants', requireAdmin, async (req, res) => {
    try {
      const clipId = String(req.params.id || '').trim();
      const container = getAppContainer();
      const existing = await container.queueRepo.getClipById(clipId);
      if (!existing) {
        res.status(404).json({ error: 'Clip not found.' });
        return;
      }
      const availableVariants = await container.orchestrator.listSavedVariants(existing);
      res.json({ clipId, availableVariants });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to list saved preview variants.',
      });
    }
  });

  // 6f. Switch to a saved audio option or generate a realtime option (Admin Test Pipeline)
  app.post('/api/clips/:id/render-option', requireAdmin, async (req, res) => {
    if (pipelineInFlight) {
      res.status(409).json({ error: 'Another render job is currently in progress.' });
      return;
    }

    const optionSchema = z.object({
      mode: z.enum([
        'broadcast-shout-1',
        'broadcast-shout-2',
        'broadcast-crowd-only',
        'pure-crowd',
      ]),
      delayOffsetSec: z.number().min(-0.8).max(1.0).optional(),
      regenerate: z.boolean().optional(),
    });
    const parsed = optionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid audio option payload.' });
      return;
    }

    pipelineInFlight = true;
    try {
      const clipId = String(req.params.id || '').trim();
      const container = getAppContainer();
      const outcome = await container.orchestrator.renderAudioOption(clipId, parsed.data);
      const snapshot = await buildDashboardSnapshot();
      res.json({ ...outcome, snapshot });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to render audio option.',
      });
    } finally {
      pipelineInFlight = false;
    }
  });

  // 7. Manual trigger: Process & auto-publish oldest pending clip (or enter Test Preview if admin passes testPreview=true)
  app.post('/api/queue/process-next', requireAdmin, async (req, res) => {
    const user = res.locals.user as AuthUser;
    const isAdminTestPreview = user.role === 'admin' && req.body?.testPreview === true;

    // On Vercel there is no FFmpeg and functions time out quickly, so hand the
    // run off to the GitHub Actions worker instead of processing in-function.
    if (process.env.VERCEL) {
      if (isAdminTestPreview) {
        res.status(400).json({
          error:
            'Interactive Test Preview requires FFmpeg and runs locally (`npm run dev`). Use Process Next (Auto) or GitHub Actions in production.',
        });
        return;
      }
      try {
        const snapshot = await buildDashboardSnapshot();
        const hasPending = snapshot.clips.some((c) => c.status === 'pending');
        if (!hasPending) {
          res.json({ processed: false, clip: null, message: 'Backlog is empty. Upload a clip first.', snapshot });
          return;
        }

        const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
        const owner = process.env.GITHUB_REPO_OWNER?.trim() || process.env.VERCEL_GIT_REPO_OWNER;
        const repo = process.env.GITHUB_REPO_NAME?.trim() || process.env.VERCEL_GIT_REPO_SLUG;
        const ref = process.env.GITHUB_REPO_REF?.trim() || 'master';
        if (!token || !owner || !repo) {
          res.status(400).json({
            error:
              'On-demand runs on Vercel need GITHUB_DISPATCH_TOKEN set. Or run it from GitHub → Actions → Upload Football Short → Run workflow.',
          });
          return;
        }

        const ghResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/workflows/upload-short.yml/dispatches`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${token}`,
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'goalcast-ai',
            },
            body: JSON.stringify({ ref }),
          }
        );
        if (!ghResp.ok) {
          const detail = await ghResp.text();
          res.status(502).json({ error: `GitHub workflow dispatch failed (${ghResp.status}): ${detail.slice(0, 200)}` });
          return;
        }

        res.json({
          processed: false,
          clip: null,
          message: 'Pipeline started on GitHub Actions. Refresh in ~2–3 minutes to see the result.',
          snapshot,
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Could not start pipeline.' });
      }
      return;
    }

    if (pipelineInFlight) {
      res.status(409).json({ error: 'A clip is already being processed.' });
      return;
    }

    pipelineInFlight = true;
    try {
      const container = getAppContainer();
      const outcome = await container.orchestrator.processOldestPendingClip({
        requireApproval: isAdminTestPreview,
      });
      const snapshot = await buildDashboardSnapshot();
      res.json({ ...outcome, snapshot });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Processing failed.',
      });
    } finally {
      pipelineInFlight = false;
    }
  });

  // 8. One-Click YouTube OAuth URL
  app.get('/api/auth/youtube/url', requireAuth, (_req, res) => {
    if (!isYouTubeOAuthConfigured()) {
      res.status(400).json({
        error: 'YouTube OAuth credentials are not configured on the server yet.',
      });
      return;
    }

    try {
      const redirectUri = resolveYouTubeRedirectUri();
      const oauth2Client = createYouTubeOAuthClient(redirectUri);
      const state = issueOAuthState();
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        scope: YOUTUBE_OAUTH_SCOPES,
        state,
      });
      res.json({ url });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not start YouTube connection.',
      });
    }
  });

  // 9. YouTube OAuth Callback
  app.get(['/auth/youtube/callback', '/auth/youtube/callback/'], async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

    if (oauthError) {
      res.status(400).send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px;">
        <h3>YouTube authorization canceled</h3>
        <p>${escapeHtml(oauthError)}</p>
        <script>if(window.opener){window.opener.postMessage({type:'GOALCAST_YOUTUBE_ERROR',error:${JSON.stringify(oauthError)}},'*');window.close();}</script>
      </body></html>`);
      return;
    }

    if (!code || !state || !consumeOAuthState(state)) {
      res.status(400).send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px;">
        <h3>Invalid or expired OAuth session</h3>
        <p>Close this window and click Connect YouTube again.</p>
      </body></html>`);
      return;
    }

    try {
      const tokens = await exchangeYouTubeAuthCode(code, resolveYouTubeRedirectUri());
      const container = getAppContainer();
      await container.channelRepo.saveTokens(tokens);

      res.send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px;">
        <h3>YouTube Channel Connected</h3>
        <p>${escapeHtml(tokens.channelTitle)} is ready. Closing window...</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GOALCAST_YOUTUBE_CONNECTED' }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        </script>
      </body></html>`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Token exchange failed.';
      res.status(500).send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px;">
        <h3>Connection Error</h3>
        <p>${escapeHtml(msg)}</p>
        <script>if(window.opener){window.opener.postMessage({type:'GOALCAST_YOUTUBE_ERROR',error:${JSON.stringify(msg)}},'*');}</script>
      </body></html>`);
    }
  });

  // 10. Disconnect YouTube
  app.post('/api/auth/youtube/disconnect', requireAuth, async (_req, res) => {
    try {
      const container = getAppContainer();
      await container.channelRepo.clearTokens();
      const snapshot = await buildDashboardSnapshot();
      res.json({ disconnected: true, snapshot });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to disconnect YouTube.',
      });
    }
  });

  return app;
}

async function createStandaloneApp() {
  const app = createApiApp();
  const isProd = env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

if (!process.env.VERCEL) {
  createStandaloneApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`GoalCast AI server running on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start GoalCast AI server:', err);
      process.exit(1);
    });
}
