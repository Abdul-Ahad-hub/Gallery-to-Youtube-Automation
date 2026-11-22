import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { QueueClip } from '../domain/types.js';
import type {
  IAudioMixer,
  IChannelRepository,
  IQueueRepository,
  IShortsPublisher,
  IVideoAnalyzer,
  IVideoFormatter,
  IVideoStorageProvider,
  IVoiceSynthesizer,
} from '../interfaces/providers.js';

export interface PipelineDependencies {
  queueRepo: IQueueRepository;
  channelRepo: IChannelRepository;
  storage: IVideoStorageProvider;
  formatter: IVideoFormatter;
  analyzer: IVideoAnalyzer;
  voiceSynthesizer: IVoiceSynthesizer;
  audioMixer: IAudioMixer;
  publisher: IShortsPublisher;
}

export interface PipelineRunOutcome {
  processed: boolean;
  clip: QueueClip | null;
  message: string;
}

/**
 * SOLID pipeline orchestrator. Every provider (Vercel Blob storage, FFmpeg, Gemini,
 * ElevenLabs/Edge TTS, YouTube Data API) is injected via interface so the pipeline
 * stays cleanly decoupled.
 */
export class GoalCastPipelineOrchestrator {
  private readonly deps: PipelineDependencies;

  constructor(deps: PipelineDependencies) {
    this.deps = deps;
  }

  async processOldestPendingClip(): Promise<PipelineRunOutcome> {
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
    const verticalPath = path.join(workDir, 'vertical_9_16.mp4');
    const voicePath = path.join(workDir, 'commentary.mp3');
    const finalPath = path.join(workDir, 'final_short.mp4');

    try {
      // Step 1: Download raw clip from Vercel Blob (or local preview disk)
      const hasRawBinary = await this.deps.storage.downloadToFile(clip.blobUrl, rawPath);

      // Step 2: Gemini Video Understanding + Dynamic Camera Tracking + AI Title, Description & Script
      // Analyze the original wide raw video first so Gemini sees the full pitch and tracks the ball accurately.
      await this.deps.queueRepo.updateStage(clip.id, 'analyzing_video');
      const analysis = await this.deps.analyzer.analyzeGoalClip({
        videoPath: hasRawBinary ? rawPath : null,
        mimeType: clip.mimeType,
        originalFilename: clip.originalFilename,
        durationSec: clip.durationSec,
      });
      await this.deps.queueRepo.updateAnalysis(clip.id, {
        shortsTitle: analysis.shortsTitle,
        shortsDescription: analysis.shortsDescription,
        commentaryScript: analysis.fullScript,
        commentaryCues: analysis.cues,
      });

      // Step 3: Full-Screen 9:16 Pan & Scan Formatting using Gemini's cameraTrack keyframes
      await this.deps.queueRepo.updateStage(clip.id, 'formatting_9_16');
      let formattedVideoPath: string | null = null;
      if (hasRawBinary) {
        try {
          await this.deps.formatter.formatToVerticalShorts(
            rawPath,
            verticalPath,
            analysis.cameraTrack
          );
          formattedVideoPath = verticalPath;
        } catch (formatErr) {
          throw new Error(
            `FFmpeg 9:16 formatting failed: ${formatErr instanceof Error ? formatErr.message : String(formatErr)}`
          );
        }
      }

      // Step 4: Passionate Voiceover Synthesis (ElevenLabs primary -> Edge TTS automatic fallback)
      await this.deps.queueRepo.updateStage(clip.id, 'synthesizing_voice');
      const voiceResult = await this.deps.voiceSynthesizer.synthesize(analysis.cues, voicePath);

      // Step 5: Audio Mixing & Crowd Ducking (pure FFmpeg, zero manual editing)
      let readyToUploadPath: string | null = formattedVideoPath;
      if (formattedVideoPath && voiceResult.audioPath) {
        await this.deps.queueRepo.updateStage(clip.id, 'mixing_audio');
        await this.deps.audioMixer.mixVoiceoverWithDucking(
          formattedVideoPath,
          voiceResult.audioPath,
          finalPath
        );
        readyToUploadPath = finalPath;
      }

      // Step 6: Automatic YouTube Shorts Upload
      await this.deps.queueRepo.updateStage(clip.id, 'uploading_youtube');
      const youtubeTokens = await this.deps.channelRepo.getTokens();
      if (!youtubeTokens) {
        const errorMsg =
          'AI title, description, and commentary generated, but no YouTube channel is connected. Connect YouTube and retry to publish.';
        const failed = await this.deps.queueRepo.markFailed(clip.id, errorMsg);
        return {
          processed: true,
          clip: failed,
          message: errorMsg,
        };
      }

      const publishResult = await this.deps.publisher.publishShort({
        videoPath: readyToUploadPath,
        title: analysis.shortsTitle,
        description: analysis.shortsDescription,
        tags: analysis.tags,
        tokens: youtubeTokens,
      });

      // Step 7: Immediate Vercel Blob Cleanup ONLY after YouTube confirms the upload
      await this.deps.queueRepo.updateStage(clip.id, 'cleaning_storage');
      await this.deps.storage.deleteObject(clip.blobUrl);
      const storageCleanedAt = new Date().toISOString();

      const completed = await this.deps.queueRepo.markUploaded(clip.id, {
        youtubeVideoId: publishResult.youtubeVideoId,
        youtubeUrl: publishResult.youtubeUrl,
        shortsTitle: analysis.shortsTitle,
        shortsDescription: analysis.shortsDescription,
        commentaryScript: analysis.fullScript,
        commentaryCues: analysis.cues,
        voiceProviderUsed:
          voiceResult.providerUsed === 'elevenlabs'
            ? 'ElevenLabs'
            : voiceResult.providerUsed === 'edge-tts'
              ? 'Edge TTS'
              : 'Edge TTS',
        storageCleanedAt,
      });

      return {
        processed: true,
        clip: completed,
        message: `Published "${analysis.shortsTitle}" to YouTube Shorts and deleted the temporary video.`,
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
}
