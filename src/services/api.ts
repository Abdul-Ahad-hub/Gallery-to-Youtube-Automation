import { upload } from '@vercel/blob/client';
import type { AuthUser } from '../core/auth/session';
import type { CrowdAudioMode, DashboardSnapshot, QueueClip } from '../core/domain/types';

export async function fetchAuthMe(): Promise<{
  authenticated: boolean;
  user: AuthUser | null;
}> {
  const response = await fetch('/api/auth/me');
  return parseJsonResponse(response);
}

export async function loginUser(
  username: string,
  password: string
): Promise<{
  authenticated: boolean;
  user: AuthUser;
}> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return parseJsonResponse(response);
}

export async function logoutUser(): Promise<{ ok: boolean }> {
  const response = await fetch('/api/auth/logout', { method: 'POST' });
  return parseJsonResponse(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error === 'string' && payload.error.length > 0
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function buildSafeBlobPathname(filename: string): string {
  const clean = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'goal_clip.mp4';
  return `clips/${Date.now()}-${clean}`;
}

export async function fetchDashboard(): Promise<DashboardSnapshot> {
  const response = await fetch('/api/dashboard');
  return parseJsonResponse<DashboardSnapshot>(response);
}

/**
 * Uploads 6-second football clips directly to Vercel Blob via client uploads
 * (bypassing Vercel's 4.5 MB serverless limit) and registers each clip as PENDING
 * in Neon PostgreSQL. Falls back to the local preview endpoint when running without
 * BLOB_READ_WRITE_TOKEN.
 */
export async function uploadClips(
  files: File[],
  uploadMode: DashboardSnapshot['uploadMode'],
  onProgress?: (completed: number, total: number) => void
): Promise<{
  uploadedCount: number;
  clips: QueueClip[];
  snapshot: DashboardSnapshot;
}> {
  if (uploadMode === 'vercel-blob') {
    const createdClips: QueueClip[] = [];
    let latestSnapshot: DashboardSnapshot | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pathname = buildSafeBlobPathname(file.name);

      const blob = await upload(pathname, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
      });

      const registerResponse = await fetch('/api/clips/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobUrl: blob.url,
          blobPathname: blob.pathname,
          originalFilename: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type || 'video/mp4',
        }),
      });

      const registered = await parseJsonResponse<{
        clip: QueueClip;
        snapshot: DashboardSnapshot;
      }>(registerResponse);

      createdClips.push(registered.clip);
      latestSnapshot = registered.snapshot;
      onProgress?.(i + 1, files.length);
    }

    const snapshot = latestSnapshot ?? (await fetchDashboard());
    return {
      uploadedCount: createdClips.length,
      clips: createdClips,
      snapshot,
    };
  }

  // Local preview multipart upload fallback
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const response = await fetch('/api/clips/upload', {
    method: 'POST',
    body: formData,
  });
  const result = await parseJsonResponse<{
    uploadedCount: number;
    clips: QueueClip[];
    snapshot: DashboardSnapshot;
  }>(response);
  onProgress?.(files.length, files.length);
  return result;
}

export async function retryClip(clipId: string): Promise<{
  clip: QueueClip;
  snapshot: DashboardSnapshot;
}> {
  const response = await fetch(`/api/clips/${encodeURIComponent(clipId)}/retry`, {
    method: 'POST',
  });
  return parseJsonResponse(response);
}

export async function deleteClip(clipId: string): Promise<{
  deletedId: string;
  snapshot: DashboardSnapshot;
}> {
  const response = await fetch(`/api/clips/${encodeURIComponent(clipId)}`, {
    method: 'DELETE',
  });
  return parseJsonResponse(response);
}

export async function triggerProcessNext(options?: {
  testPreview?: boolean;
}): Promise<{
  processed: boolean;
  clip: QueueClip | null;
  message: string;
  snapshot: DashboardSnapshot;
}> {
  const response = await fetch('/api/queue/process-next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testPreview: Boolean(options?.testPreview) }),
  });
  return parseJsonResponse(response);
}

export async function approveClipUpload(clipId: string): Promise<{
  processed: boolean;
  clip: QueueClip | null;
  message: string;
  snapshot: DashboardSnapshot;
}> {
  const response = await fetch(`/api/clips/${encodeURIComponent(clipId)}/approve`, {
    method: 'POST',
  });
  return parseJsonResponse(response);
}

export async function rerenderClip(clipId: string): Promise<{
  clip: QueueClip;
  snapshot: DashboardSnapshot;
}> {
  const response = await fetch(`/api/clips/${encodeURIComponent(clipId)}/rerender`, {
    method: 'POST',
  });
  return parseJsonResponse(response);
}

export async function fetchClipVariants(clipId: string): Promise<{
  clipId: string;
  availableVariants: CrowdAudioMode[];
}> {
  const response = await fetch(`/api/clips/${encodeURIComponent(clipId)}/variants`);
  return parseJsonResponse(response);
}

export async function renderClipAudioOption(
  clipId: string,
  payload: {
    mode: CrowdAudioMode;
    delayOffsetSec?: number;
    regenerate?: boolean;
  }
): Promise<{
  processed: boolean;
  clip: QueueClip | null;
  message: string;
  activeMode: CrowdAudioMode;
  availableVariants: CrowdAudioMode[];
  snapshot: DashboardSnapshot;
}> {
  const response = await fetch(`/api/clips/${encodeURIComponent(clipId)}/render-option`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response);
}

export function getClipPreviewUrl(
  clipId: string,
  source: 'rendered' | 'raw' = 'rendered',
  cacheBuster?: string
): string {
  const params = new URLSearchParams();
  if (source === 'raw') params.set('source', 'raw');
  if (cacheBuster) params.set('v', cacheBuster);
  const query = params.toString();
  return `/api/clips/${encodeURIComponent(clipId)}/preview${query ? `?${query}` : ''}`;
}

export async function fetchYouTubeAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  const response = await fetch('/api/auth/youtube/url');
  return parseJsonResponse(response);
}

export async function disconnectYouTube(): Promise<{
  disconnected: boolean;
  snapshot: DashboardSnapshot;
}> {
  const response = await fetch('/api/auth/youtube/disconnect', {
    method: 'POST',
  });
  return parseJsonResponse(response);
}
