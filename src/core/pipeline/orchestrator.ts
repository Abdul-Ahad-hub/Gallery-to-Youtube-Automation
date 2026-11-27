import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isUploadApprovalRequired } from '../../config/env.js';
import { generateFootballShortMetadata } from '../domain/commentary-sync.js';
import type { CrowdAudioMode, QueueClip, VideoSemanticTiming } from '../domain/types.js';
import type {
  IAudioMixer,
  IChannelRepository,
  ICrowdAudioProvider,
  IQueueRepository,
  IShortsPublisher,
  IVideoAnalyzer,
  IVideoFormatter,
  IVideoStorageProvider,
} from '../interfaces/providers.js';
import { probeVideoDurationSec } from '../providers/video/ffmpeg-media.js';

export const ALL_CROWD_AUDIO_MODES: readonly CrowdAudioMode[] = [
  'broadcast-shout-1',
  'broadcast-shout-2',
  'broadcast-crowd-only',
  'pure-crowd',
] as const;

const MODE_LABELS: Record<CrowdAudioMode, string> = {
  'broadcast-shout-1': 'Commentary + "What a strike!"',
  'broadcast-shout-2': 'Commentary + "GOOOAL!!"',
  'broadcast-crowd-only': 'Commentary + Crowd Roar',
  'pure-crowd': 'Crowd Only',
};

export interface PipelineDependencies {
  queueRepo: IQueueRepository;
  channelRepo: IChannelRepository;
  storage: IVideoStorageProvider;
  formatter: IVideoFormatter;
  analyzer: IVideoAnalyzer;
  crowdAudio: ICrowdAudioProvider;
  audioMixer: IAudioMixer;
  publisher: IShortsPublisher;
}

export interface PipelineRunOutcome {
  processed: boolean;
  clip: QueueClip | null;
  message: string;
}

interface ParsedClipMetadata {
  riseStartSec?: number;
  eruptSec?: number;
  buildupLine?: string;
  elevenLabsPrompt?: string;
  variants: Partial<Record<CrowdAudioMode, string>>;
}

function parseClipMetadata(script: string | null): ParsedClipMetadata {
  const result: ParsedClipMetadata = { variants: {} };
  if (!script) return result;

  const riseMatch = /Rise:\s*([0-9.]+)s/i.exec(script);
  const eruptMatch = /Erupt:\s*([0-9.]+)s/i.exec(script);
  const buildupMatch = /Buildup:\s*(.+)/i.exec(script);
  const promptMatch = /Prompt:\s*(.+)/i.exec(script);
  const variantsMatch = /\[variants:(\{[^\n]*\})\]/i.exec(script);

  if (riseMatch) result.riseStartSec = Number.parseFloat(riseMatch[1]);
  if (eruptMatch) result.eruptSec = Number.parseFloat(eruptMatch[1]);
  if (buildupMatch) result.buildupLine = buildupMatch[1].trim();
  if (promptMatch) result.elevenLabsPrompt = promptMatch[1].trim();
  if (variantsMatch) {
    try {
      const parsed = JSON.parse(variantsMatch[1]) as Partial<Record<CrowdAudioMode, string>>;
      if (parsed && typeof parsed === 'object') {
        result.variants = parsed;
      }
    } catch {
      // Ignore malformed metadata
    }
  }
  return result;
}

function serializeClipMetadata(params: {
  riseStartSec: number;
  eruptSec: number;
  delayOffsetSec: number;
  buildupLine: string;
  activeLabel: string;
  elevenLabsPrompt: string;
  variants: Partial<Record<CrowdAudioMode, string>>;
}): string {
  const effective = Math.max(0.5, params.eruptSec + params.delayOffsetSec).toFixed(2);
  return [
    `Buildup: ${params.buildupLine}`,
    `Rise: ${params.riseStartSec.toFixed(2)}s | Erupt: ${params.eruptSec.toFixed(2)}s (nudge ${params.delayOffsetSec >= 0 ? '+' : ''}${params.delayOffsetSec.toFixed(2)}s -> ${effective}s)`,
    `Active: ${params.activeLabel}`,
    `Prompt: ${params.elevenLabsPrompt}`,
    `[variants:${JSON.stringify(params.variants)}]`,
  ].join('\n');
}

/**
 * SOLID pipeline orchestrator. Every provider (storage, FFmpeg orientation & audio muxing,
 * Gemini semantic timing + buildup + title, 3-layer broadcast crowd audio, YouTube Data API)
 * is injected via interface so the pipeline stays cleanly decoupled.
 */
export class GoalCastPipelineOrchestrator {
  private readonly deps: PipelineDependencies;

  constructor(deps: PipelineDependencies) {
    this.deps = deps;
  }

  async listSavedVariants(clip: QueueClip): Promise<CrowdAudioMode[]> {
    const parsed = parseClipMetadata(clip.commentaryScript);
    const checks = await Promise.all(
      ALL_CROWD_AUDIO_MODES.map(async (mode) => {
        const candidateUrl = parsed.variants[mode] ?? `local://rendered/${clip.id}/${mode}.mp4`;
        const exists = await this.deps.storage.objectExists(candidateUrl).catch(() => false);
        return exists ? mode : null;
      })
    );
    return checks.filter((m): m is CrowdAudioMode => m !== null);
  }

  async processOldestPendingClip(options?: {
    requireApproval?: boolean;
  }): Promise<PipelineRunOutcome> {
    const requireApproval = options?.requireApproval ?? isUploadApprovalRequired();
    const clip = await this.deps.queueRepo.claimOldestPendingClip();
    if (!clip) {
      return {
        processed: false,
        clip: null,
        message: 'Backlog queue is empty. Nothing to process.',
      };
    }

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `goalcast-${clip.id}-`));
    const rawPath = path.join(workDir, 'raw.mp4');
    const verticalPath = path.join(workDir, 'vertical_fullres.mp4');
    const crowdAudioPath = path.join(workDir, 'broadcast_mix.m4a');
    const finalPath = path.join(workDir, 'final_short.mp4');

    try {
      // Step 1: Download raw clip from storage
      const hasRawBinary = await this.deps.storage.downloadToFile(clip.blobUrl, rawPath);
      if (!hasRawBinary) {
        throw new Error('Raw video file could not be downloaded for processing.');
      }

      const actualDuration = (await probeVideoDurationSec(rawPath)) ?? (clip.durationSec || 6.0);

      // Step 2: Gemini watches tiny proxy for buildup situation (0-3.5s) + semantic timing + viral title
      await this.deps.queueRepo.updateStage(clip.id, 'analyzing_video');
      const semantic: VideoSemanticTiming = await this.deps.analyzer.analyzeSemanticTimingAndTitle({
        videoPath: rawPath,
        mimeType: clip.mimeType,
        originalFilename: clip.originalFilename,
        durationSec: actualDuration,
      });

      // Step 3: Full-res Shorts orientation (rotate 90° clockwise if landscape, zero crop/blur)
      await this.deps.queueRepo.updateStage(clip.id, 'formatting_9_16');
      try {
        await this.deps.formatter.formatToVerticalShorts(rawPath, verticalPath);
      } catch (formatErr) {
        throw new Error(
          `FFmpeg Shorts orientation failed: ${formatErr instanceof Error ? formatErr.message : String(formatErr)}`
        );
      }

      // Step 4: 3-layer broadcast mix randomly chosen across all 4 modes (+0.3s burst/shout sync)
      const initialPool: CrowdAudioMode[] = [
        'broadcast-shout-1',
        'broadcast-shout-2',
        'broadcast-crowd-only',
        'pure-crowd',
      ];
      const initialMode = initialPool[Math.floor(Math.random() * initialPool.length)];
      const defaultDelayOffset = 0.3;

      await this.deps.queueRepo.updateStage(clip.id, 'generating_crowd_audio');
      const crowdResult = await this.deps.crowdAudio.composeOption({
        mode: initialMode,
        durationSec: actualDuration,
        outputAudioPath: crowdAudioPath,
        riseStartSec: semantic.riseStartSec,
        eruptSec: semantic.eruptSec,
        delayOffsetSec: defaultDelayOffset,
        buildupLine: semantic.buildupLine,
        elevenLabsPrompt: semantic.elevenLabsPrompt,
      });

      // Step 5: Mux composed broadcast audio onto full-res video
      await this.deps.queueRepo.updateStage(clip.id, 'mixing_audio');
      await this.deps.audioMixer.replaceAudioTrack(verticalPath, crowdResult.audioPath, finalPath);

      // Step 6a: Hold for manual preview, multi-option comparison & OK-to-upload approval
      if (requireApproval) {
        const finalBuffer = await fs.readFile(finalPath);
        const savedMode = crowdResult.mode;
        const savedPreview = await this.deps.storage.uploadBuffer(
          `rendered/${clip.id}/${savedMode}.mp4`,
          finalBuffer,
          'video/mp4'
        );

        const variants: Partial<Record<CrowdAudioMode, string>> = {
          [savedMode]: savedPreview.url,
        };
        const metadataText = serializeClipMetadata({
          riseStartSec: semantic.riseStartSec,
          eruptSec: semantic.eruptSec,
          delayOffsetSec: defaultDelayOffset,
          buildupLine: semantic.buildupLine,
          activeLabel: crowdResult.label,
          elevenLabsPrompt: semantic.elevenLabsPrompt,
          variants,
        });

        const readyClip = await this.deps.queueRepo.markReadyForReview(clip.id, {
          renderedVideoUrl: savedPreview.url,
          shortsTitle: semantic.shortsTitle,
          shortsDescription: semantic.shortsDescription,
          voiceProviderUsed: crowdResult.label,
          commentaryScript: metadataText,
        });

        return {
          processed: true,
          clip: readyClip,
          message: `Final Short ready for preview (${crowdResult.label}). Compare options or click OK to upload.`,
        };
      }

      // Step 6b: Direct YouTube upload when approval gate is disabled
      await this.deps.queueRepo.updateStage(clip.id, 'uploading_youtube');
      const youtubeTokens = await this.deps.channelRepo.getTokens();
      if (!youtubeTokens) {
        const errorMsg =
          'Short rendered with broadcast audio, but no YouTube channel is connected. Connect YouTube and retry to publish.';
        const failed = await this.deps.queueRepo.markFailed(clip.id, errorMsg);
        return {
          processed: true,
          clip: failed,
          message: errorMsg,
        };
      }

      const publishResult = await this.deps.publisher.publishShort({
        videoPath: finalPath,
        title: semantic.shortsTitle,
        description: semantic.shortsDescription,
        tags: semantic.tags,
        tokens: youtubeTokens,
      });

      await this.deps.queueRepo.updateStage(clip.id, 'cleaning_storage');
      await this.deps.storage.deleteObject(clip.blobUrl);
      const storageCleanedAt = new Date().toISOString();

      const completed = await this.deps.queueRepo.markUploaded(clip.id, {
        youtubeVideoId: publishResult.youtubeVideoId,
        youtubeUrl: publishResult.youtubeUrl,
        shortsTitle: semantic.shortsTitle,
        shortsDescription: semantic.shortsDescription,
        commentaryScript: `Buildup: ${semantic.buildupLine}\nActive: ${crowdResult.label}`,
        commentaryCues: [],
        voiceProviderUsed: crowdResult.label,
        storageCleanedAt,
      });

      return {
        processed: true,
        clip: completed,
        message: `Published "${semantic.shortsTitle}" to YouTube Shorts and deleted the temporary video.`,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unexpected pipeline error occurred.';
      const failed = await this.deps.queueRepo.markFailed(clip.id, errorMessage);
      return {
        processed: true,
        clip: failed,
        message: errorMessage,
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Switches to a saved audio variant instantly, or generates/renders a requested
   * audio option (`broadcast-shout-1`, `broadcast-shout-2`, `broadcast-crowd-only`, `pure-crowd`)
   * in real time with the chosen timing nudge.
   */
  async renderAudioOption(
    clipId: string,
    options: {
      mode: CrowdAudioMode;
      delayOffsetSec?: number;
      regenerate?: boolean;
    }
  ): Promise<
    PipelineRunOutcome & {
      activeMode: CrowdAudioMode;
      availableVariants: CrowdAudioMode[];
    }
  > {
    const existing = await this.deps.queueRepo.getClipById(clipId);
    if (!existing) {
      return {
        processed: false,
        clip: null,
        message: 'Clip not found.',
        activeMode: options.mode,
        availableVariants: [],
      };
    }
    if (existing.status !== 'ready_for_review') {
      return {
        processed: false,
        clip: existing,
        message: 'Clip must be in Final Preview status to switch or generate audio options.',
        activeMode: options.mode,
        availableVariants: [],
      };
    }

    const parsedMeta = parseClipMetadata(existing.commentaryScript);
    const delayOffsetSec = options.delayOffsetSec ?? 0.3;
    const savedUrl =
      parsedMeta.variants[options.mode] ?? `local://rendered/${clipId}/${options.mode}.mp4`;

    if (!options.regenerate && options.delayOffsetSec === undefined) {
      const exists = await this.deps.storage.objectExists(savedUrl).catch(() => false);
      if (exists) {
        const label = MODE_LABELS[options.mode];
        const updated = await this.deps.queueRepo.markReadyForReview(clipId, {
          renderedVideoUrl: savedUrl,
          shortsTitle:
            existing.shortsTitle ||
            generateFootballShortMetadata(existing.originalFilename).shortsTitle,
          shortsDescription:
            existing.shortsDescription ||
            generateFootballShortMetadata(existing.originalFilename).shortsDescription,
          voiceProviderUsed: label,
          commentaryScript: existing.commentaryScript || '',
        });
        const availableVariants = updated ? await this.listSavedVariants(updated) : [];
        return {
          processed: true,
          clip: updated,
          message: `Switched to saved ${label} version.`,
          activeMode: options.mode,
          availableVariants,
        };
      }
    }

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `goalcast-opt-${clipId}-`));
    const rawPath = path.join(workDir, 'raw.mp4');
    const verticalPath = path.join(workDir, 'vertical_fullres.mp4');
    const crowdAudioPath = path.join(workDir, 'broadcast_opt.m4a');
    const finalPath = path.join(workDir, 'final_opt.mp4');

    try {
      const hasRawBinary = await this.deps.storage.downloadToFile(existing.blobUrl, rawPath);
      if (!hasRawBinary) {
        throw new Error('Original uploaded video is unavailable to re-render audio options.');
      }

      const actualDuration =
        (await probeVideoDurationSec(rawPath)) ?? (existing.durationSec || 6.0);
      const riseStartSec =
        parsedMeta.riseStartSec ?? Number(Math.max(0.5, actualDuration * 0.58).toFixed(2));
      const eruptSec =
        parsedMeta.eruptSec ??
        Number((actualDuration >= 5.5 ? 4.85 : actualDuration * 0.82).toFixed(2));
      const buildupLine =
        parsedMeta.buildupLine ?? 'He drives into the box, opening up space for the strike...';
      const elevenLabsPrompt = parsedMeta.elevenLabsPrompt ?? '';

      await this.deps.formatter.formatToVerticalShorts(rawPath, verticalPath);

      const crowdResult = await this.deps.crowdAudio.composeOption({
        mode: options.mode,
        durationSec: actualDuration,
        outputAudioPath: crowdAudioPath,
        riseStartSec,
        eruptSec,
        delayOffsetSec,
        buildupLine,
        elevenLabsPrompt,
      });

      await this.deps.audioMixer.replaceAudioTrack(verticalPath, crowdResult.audioPath, finalPath);

      const finalBuffer = await fs.readFile(finalPath);
      const savedMode = crowdResult.mode;
      const savedPreview = await this.deps.storage.uploadBuffer(
        `rendered/${clipId}/${savedMode}.mp4`,
        finalBuffer,
        'video/mp4'
      );

      const nextVariants: Partial<Record<CrowdAudioMode, string>> = {
        ...parsedMeta.variants,
        [savedMode]: savedPreview.url,
      };
      const metadataText = serializeClipMetadata({
        riseStartSec,
        eruptSec,
        delayOffsetSec,
        buildupLine,
        activeLabel: crowdResult.label,
        elevenLabsPrompt,
        variants: nextVariants,
      });

      const updated = await this.deps.queueRepo.markReadyForReview(clipId, {
        renderedVideoUrl: savedPreview.url,
        shortsTitle:
          existing.shortsTitle ||
          generateFootballShortMetadata(existing.originalFilename).shortsTitle,
        shortsDescription:
          existing.shortsDescription ||
          generateFootballShortMetadata(existing.originalFilename).shortsDescription,
        voiceProviderUsed: crowdResult.label,
        commentaryScript: metadataText,
      });

      const availableVariants = updated ? await this.listSavedVariants(updated) : [savedMode];
      return {
        processed: true,
        clip: updated,
        message: `Generated "${crowdResult.label}" preview.`,
        activeMode: savedMode,
        availableVariants,
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async approveAndPublishClip(clipId: string): Promise<PipelineRunOutcome> {
    const existing = await this.deps.queueRepo.getClipById(clipId);
    if (!existing) {
      return {
        processed: false,
        clip: null,
        message: 'Clip not found.',
      };
    }
    if (existing.status !== 'ready_for_review' || !existing.renderedVideoUrl) {
      return {
        processed: false,
        clip: existing,
        message: 'Clip is not waiting for upload approval.',
      };
    }

    const youtubeTokens = await this.deps.channelRepo.getTokens();
    if (!youtubeTokens) {
      return {
        processed: false,
        clip: existing,
        message: 'Connect your YouTube channel first before approving upload.',
      };
    }

    const claimed = await this.deps.queueRepo.claimClipForUpload(clipId);
    if (!claimed) {
      return {
        processed: false,
        clip: existing,
        message: 'Clip could not be claimed for upload.',
      };
    }

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `goalcast-upload-${clipId}-`));
    const uploadPath = path.join(workDir, 'final_short.mp4');

    try {
      const hasRendered = await this.deps.storage.downloadToFile(
        existing.renderedVideoUrl,
        uploadPath
      );
      if (!hasRendered) {
        throw new Error(
          'Rendered preview video could not be found in storage. Re-render and try again.'
        );
      }

      const fallbackMeta = generateFootballShortMetadata(existing.originalFilename);
      const shortsTitle = existing.shortsTitle || fallbackMeta.shortsTitle;
      const shortsDescription = existing.shortsDescription || fallbackMeta.shortsDescription;

      const publishResult = await this.deps.publisher.publishShort({
        videoPath: uploadPath,
        title: shortsTitle,
        description: shortsDescription,
        tags: fallbackMeta.tags,
        tokens: youtubeTokens,
      });

      await this.deps.queueRepo.updateStage(clipId, 'cleaning_storage');
      const parsedMeta = parseClipMetadata(existing.commentaryScript);
      const cleanupTargets = new Set<string>([
        existing.blobUrl,
        existing.renderedVideoUrl,
        ...Object.values(parsedMeta.variants).filter((u): u is string => Boolean(u)),
      ]);
      await Promise.allSettled(
        Array.from(cleanupTargets).map((target) => this.deps.storage.deleteObject(target))
      );
      const storageCleanedAt = new Date().toISOString();

      const completed = await this.deps.queueRepo.markUploaded(clipId, {
        youtubeVideoId: publishResult.youtubeVideoId,
        youtubeUrl: publishResult.youtubeUrl,
        shortsTitle,
        shortsDescription,
        commentaryScript: existing.commentaryScript || '',
        commentaryCues: [],
        voiceProviderUsed: existing.voiceProviderUsed || 'Stadium Broadcast',
        storageCleanedAt,
      });

      return {
        processed: true,
        clip: completed,
        message: `Published "${shortsTitle}" to YouTube Shorts and cleaned up temporary files.`,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to upload approved Short to YouTube.';
      const failed = await this.deps.queueRepo.markFailed(clipId, errorMessage);
      return {
        processed: true,
        clip: failed,
        message: errorMessage,
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
