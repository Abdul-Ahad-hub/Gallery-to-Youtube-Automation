import type {
  CameraKeyframe,
  CommentaryCue,
  CrowdAudioMode,
  GoalAnalysisResult,
  PipelineStage,
  QueueClip,
  StoredYouTubeTokens,
  VideoSemanticTiming,
} from '../domain/types.js';

export interface CreateClipInput {
  id: string;
  originalFilename: string;
  blobUrl: string;
  blobPathname: string;
  fileSizeBytes: number;
  durationSec: number;
  mimeType: string;
  thumbnailUrl: string;
}

export interface UploadedBlobResult {
  url: string;
  pathname: string;
}

export interface IQueueRepository {
  readonly providerName: 'neon-postgres' | 'local-preview-store';
  listClips(): Promise<QueueClip[]>;
  getClipById(id: string): Promise<QueueClip | null>;
  createClip(input: CreateClipInput): Promise<QueueClip>;
  claimOldestPendingClip(): Promise<QueueClip | null>;
  updateStage(id: string, stage: PipelineStage): Promise<QueueClip | null>;
  updateAnalysis(
    id: string,
    payload: {
      shortsTitle: string;
      shortsDescription: string;
      commentaryScript: string;
      commentaryCues: CommentaryCue[];
    }
  ): Promise<QueueClip | null>;
  markReadyForReview(
    id: string,
    payload: {
      renderedVideoUrl: string;
      shortsTitle: string;
      shortsDescription: string;
      voiceProviderUsed: string;
      commentaryScript: string;
    }
  ): Promise<QueueClip | null>;
  claimClipForUpload(id: string): Promise<QueueClip | null>;
  requeueClip(id: string): Promise<QueueClip | null>;
  markUploaded(
    id: string,
    payload: {
      youtubeVideoId: string;
      youtubeUrl: string;
      shortsTitle: string;
      shortsDescription: string;
      commentaryScript: string;
      commentaryCues: CommentaryCue[];
      voiceProviderUsed: string;
      storageCleanedAt: string;
    }
  ): Promise<QueueClip | null>;
  markFailed(id: string, errorMessage: string): Promise<QueueClip | null>;
  retryClip(id: string): Promise<QueueClip | null>;
  deleteClip(id: string): Promise<boolean>;
}

export interface IChannelRepository {
  getTokens(): Promise<StoredYouTubeTokens | null>;
  saveTokens(tokens: StoredYouTubeTokens): Promise<void>;
  clearTokens(): Promise<void>;
}

export interface IVideoStorageProvider {
  readonly providerName: 'vercel-blob' | 'local-preview-disk';
  uploadBuffer(pathname: string, buffer: Buffer, contentType: string): Promise<UploadedBlobResult>;
  downloadToFile(blobUrlOrPath: string, destinationPath: string): Promise<boolean>;
  deleteObject(blobUrlOrPath: string): Promise<void>;
  objectExists(blobUrlOrPath: string): Promise<boolean>;
  resolveLocalFilePath?(blobUrlOrPath: string): string | null;
}

export interface CrowdAudioMixResult {
  audioPath: string;
  mode: CrowdAudioMode;
  normalTrackName: string;
  burstTrackName: string;
  label: string;
}

export interface ComposeCrowdOptionInput {
  mode: CrowdAudioMode;
  durationSec: number;
  outputAudioPath: string;
  riseStartSec?: number;
  eruptSec?: number;
  delayOffsetSec?: number;
  buildupLine?: string;
  elevenLabsPrompt?: string;
}

export interface ICrowdAudioProvider {
  composeCrowdTrack(
    durationSec: number,
    outputAudioPath: string,
    burstStartSec?: number
  ): Promise<CrowdAudioMixResult>;
  composeOption(input: ComposeCrowdOptionInput): Promise<CrowdAudioMixResult>;
}

export interface IVideoFormatter {
  formatToVerticalShorts(
    inputPath: string,
    outputPath: string,
    cameraTrack?: CameraKeyframe[]
  ): Promise<void>;
}

export interface IVideoAnalyzer {
  analyzeGoalClip(input: {
    videoPath: string | null;
    mimeType: string;
    originalFilename: string;
    durationSec: number;
  }): Promise<GoalAnalysisResult>;
  analyzeSemanticTimingAndTitle(input: {
    videoPath: string | null;
    mimeType: string;
    originalFilename: string;
    durationSec: number;
  }): Promise<VideoSemanticTiming>;
}

export interface VoiceSynthesisResult {
  audioPath: string | null;
  providerUsed: 'elevenlabs' | 'edge-tts' | 'script-only';
}

export interface IVoiceSynthesizer {
  synthesize(cues: CommentaryCue[], outputAudioPath: string): Promise<VoiceSynthesisResult>;
}

export interface IAudioMixer {
  mixVoiceoverWithDucking(
    formattedVideoPath: string,
    voiceoverAudioPath: string,
    finalOutputPath: string
  ): Promise<void>;
  replaceAudioTrack(
    formattedVideoPath: string,
    audioPath: string,
    finalOutputPath: string
  ): Promise<void>;
  mixOriginalAndCrowdTrack(
    formattedVideoPath: string,
    rawSourcePath: string,
    crowdAudioPath: string,
    finalOutputPath: string
  ): Promise<void>;
}

export interface PublishShortInput {
  videoPath: string | null;
  title: string;
  description: string;
  tags: string[];
  tokens: StoredYouTubeTokens;
}

export interface PublishShortResult {
  youtubeVideoId: string;
  youtubeUrl: string;
}

export interface IShortsPublisher {
  publishShort(input: PublishShortInput): Promise<PublishShortResult>;
}
