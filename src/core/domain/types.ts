export type ClipStatus = 'pending' | 'processing' | 'uploaded' | 'failed';

export type PipelineStage =
  | 'queued'
  | 'downloading'
  | 'formatting_9_16'
  | 'analyzing_video'
  | 'synthesizing_voice'
  | 'mixing_audio'
  | 'uploading_youtube'
  | 'cleaning_storage'
  | 'completed'
  | 'failed';

export type CommentaryBeatType = 'buildup' | 'strike' | 'net_impact' | 'celebration';

export interface CommentaryCue {
  beat: CommentaryBeatType;
  startSec: number;
  endSec: number;
  text: string;
  energy: 'rising' | 'peak' | 'explosive' | 'afterglow';
}

export interface CameraKeyframe {
  timeSec: number;
  centerX: number;
}

export interface GoalAnalysisResult {
  summary: string;
  strikeTimestampSec: number;
  netImpactTimestampSec: number;
  shortsTitle: string;
  shortsDescription: string;
  tags: string[];
  cues: CommentaryCue[];
  cameraTrack: CameraKeyframe[];
  fullScript: string;
}

export interface QueueClip {
  id: string;
  originalFilename: string;
  blobUrl: string;
  blobPathname: string;
  fileSizeBytes: number;
  durationSec: number;
  mimeType: string;
  thumbnailUrl: string;
  status: ClipStatus;
  pipelineStage: PipelineStage;
  voiceProviderUsed: string | null;
  commentaryScript: string | null;
  commentaryCues: CommentaryCue[];
  shortsTitle: string | null;
  shortsDescription: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  errorMessage: string | null;
  storageCleanedAt: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface YouTubeChannelConnection {
  connected: boolean;
  channelId: string | null;
  channelTitle: string | null;
  channelHandle: string | null;
  channelThumbnailUrl: string | null;
  connectedAt: string | null;
  oauthConfigured: boolean;
}

export interface StoredYouTubeTokens {
  channelId: string;
  channelTitle: string;
  channelHandle: string | null;
  channelThumbnailUrl: string | null;
  accessToken: string;
  refreshToken: string;
  expiryDate: number | null;
  connectedAt: string;
}

export interface DashboardSnapshot {
  clips: QueueClip[];
  channel: YouTubeChannelConnection;
  uploadMode: 'vercel-blob' | 'local-preview';
  nextRunIso: string;
}
