import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CommentaryCue,
  PipelineStage,
  QueueClip,
  StoredYouTubeTokens,
} from '../../domain/types.js';
import { selectNextPendingClip } from '../../domain/schedule.js';
import type {
  CreateClipInput,
  IChannelRepository,
  IQueueRepository,
} from '../../interfaces/providers.js';

interface LocalStoreFile {
  clips: QueueClip[];
  youtube: StoredYouTubeTokens | null;
}

export class LocalPreviewRepository implements IQueueRepository, IChannelRepository {
  public readonly providerName = 'local-preview-store' as const;
  private readonly storeFilePath: string;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(baseDir: string = path.resolve(process.cwd(), 'data')) {
    this.storeFilePath = path.join(baseDir, 'goalcast-state.json');
  }

  private async readState(): Promise<LocalStoreFile> {
    try {
      const content = await fs.readFile(this.storeFilePath, 'utf-8');
      const parsed = JSON.parse(content) as LocalStoreFile;
      if (!Array.isArray(parsed.clips) || parsed.clips.some((c) => !('blobUrl' in c))) {
        throw new Error('Migrate preview store schema');
      }
      return parsed;
    } catch {
      const emptyState: LocalStoreFile = {
        clips: [],
        youtube: null,
      };
      await this.writeState(emptyState);
      return emptyState;
    }
  }

  private async writeState(state: LocalStoreFile): Promise<void> {
    await fs.mkdir(path.dirname(this.storeFilePath), { recursive: true });
    await fs.writeFile(this.storeFilePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  private async withLock<T>(operation: (state: LocalStoreFile) => Promise<T> | T): Promise<T> {
    let result!: T;
    this.writeLock = this.writeLock.then(async () => {
      const state = await this.readState();
      result = await operation(state);
      await this.writeState(state);
    });
    await this.writeLock;
    return result;
  }

  async listClips(): Promise<QueueClip[]> {
    const state = await this.readState();
    const order: Record<QueueClip['status'], number> = {
      processing: 0,
      ready_for_review: 1,
      pending: 2,
      failed: 3,
      uploaded: 4,
    };
    return [...state.clips].sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  async getClipById(id: string): Promise<QueueClip | null> {
    const state = await this.readState();
    return state.clips.find((c) => c.id === id) ?? null;
  }

  async createClip(input: CreateClipInput): Promise<QueueClip> {
    return this.withLock((state) => {
      const now = new Date().toISOString();
      const clip: QueueClip = {
        id: input.id,
        originalFilename: input.originalFilename,
        blobUrl: input.blobUrl,
        blobPathname: input.blobPathname,
        fileSizeBytes: input.fileSizeBytes,
        contentHash: input.contentHash ?? null,
        durationSec: input.durationSec,
        mimeType: input.mimeType,
        thumbnailUrl: input.thumbnailUrl,
        status: 'pending',
        pipelineStage: 'queued',
        renderedVideoUrl: null,
        voiceProviderUsed: null,
        commentaryScript: null,
        commentaryCues: [],
        shortsTitle: null,
        shortsDescription: null,
        youtubeVideoId: null,
        youtubeUrl: null,
        errorMessage: null,
        storageCleanedAt: null,
        createdAt: now,
        updatedAt: now,
        processedAt: null,
      };
      state.clips.push(clip);
      return clip;
    });
  }

  async claimOldestPendingClip(): Promise<QueueClip | null> {
    return this.withLock((state) => {
      const next = selectNextPendingClip(state.clips);
      if (!next) return null;
      next.status = 'processing';
      next.pipelineStage = 'downloading';
      next.errorMessage = null;
      next.updatedAt = new Date().toISOString();
      return { ...next };
    });
  }

  async updateStage(id: string, stage: PipelineStage): Promise<QueueClip | null> {
    return this.withLock((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip) return null;
      clip.pipelineStage = stage;
      clip.updatedAt = new Date().toISOString();
      return { ...clip };
    });
  }

  async updateAnalysis(
    id: string,
    payload: {
      shortsTitle: string;
      shortsDescription: string;
      commentaryScript: string;
      commentaryCues: CommentaryCue[];
    }
  ): Promise<QueueClip | null> {
    return this.withLock((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip) return null;
      clip.shortsTitle = payload.shortsTitle;
      clip.shortsDescription = payload.shortsDescription;
      clip.commentaryScript = payload.commentaryScript;
      clip.commentaryCues = payload.commentaryCues;
      clip.updatedAt = new Date().toISOString();
      return { ...clip };
    });
  }

  async markReadyForReview(
    id: string,
    payload: {
      renderedVideoUrl: string;
      shortsTitle: string;
      shortsDescription: string;
      voiceProviderUsed: string;
      commentaryScript: string;
    }
  ): Promise<QueueClip | null> {
    return this.withLock((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip) return null;
      clip.status = 'ready_for_review';
      clip.pipelineStage = 'awaiting_approval';
      clip.renderedVideoUrl = payload.renderedVideoUrl;
      clip.shortsTitle = payload.shortsTitle;
      clip.shortsDescription = payload.shortsDescription;
      clip.voiceProviderUsed = payload.voiceProviderUsed;
      clip.commentaryScript = payload.commentaryScript;
      clip.errorMessage = null;
      clip.updatedAt = new Date().toISOString();
      return { ...clip };
    });
  }

  async claimClipForUpload(id: string): Promise<QueueClip | null> {
    return this.withLock((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip || clip.status !== 'ready_for_review') return null;
      clip.status = 'processing';
      clip.pipelineStage = 'uploading_youtube';
      clip.errorMessage = null;
      clip.updatedAt = new Date().toISOString();
      return { ...clip };
    });
  }

  async requeueClip(id: string): Promise<QueueClip | null> {
    return this.withLock((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip || (clip.status !== 'failed' && clip.status !== 'ready_for_review')) return null;
      clip.status = 'pending';
      clip.pipelineStage = 'queued';
      clip.renderedVideoUrl = null;
      clip.errorMessage = null;
      clip.updatedAt = new Date().toISOString();
      return { ...clip };
    });
  }

  async markUploaded(
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
  ): Promise<QueueClip | null> {
    return this.withLock((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip) return null;
      const now = new Date().toISOString();
      clip.status = 'uploaded';
      clip.pipelineStage = 'completed';
      clip.renderedVideoUrl = null;
      clip.youtubeVideoId = payload.youtubeVideoId;
      clip.youtubeUrl = payload.youtubeUrl;
      clip.shortsTitle = payload.shortsTitle;
      clip.shortsDescription = payload.shortsDescription;
      clip.commentaryScript = payload.commentaryScript;
      clip.commentaryCues = payload.commentaryCues;
      clip.voiceProviderUsed = payload.voiceProviderUsed;
      clip.storageCleanedAt = payload.storageCleanedAt;
      clip.errorMessage = null;
      clip.processedAt = now;
      clip.updatedAt = now;
      return { ...clip };
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<QueueClip | null> {
    return this.withLock((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip) return null;
      clip.status = 'failed';
      clip.pipelineStage = 'failed';
      clip.errorMessage = errorMessage;
      clip.updatedAt = new Date().toISOString();
      return { ...clip };
    });
  }

  async retryClip(id: string): Promise<QueueClip | null> {
    return this.withLock((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip || clip.status !== 'failed') return null;
      clip.status = 'pending';
      clip.pipelineStage = 'queued';
      clip.errorMessage = null;
      clip.updatedAt = new Date().toISOString();
      return { ...clip };
    });
  }

  async deleteClip(id: string): Promise<boolean> {
    return this.withLock((state) => {
      const idx = state.clips.findIndex((c) => c.id === id);
      if (idx === -1) return false;
      state.clips.splice(idx, 1);
      return true;
    });
  }

  async getTokens(): Promise<StoredYouTubeTokens | null> {
    const state = await this.readState();
    return state.youtube;
  }

  async saveTokens(tokens: StoredYouTubeTokens): Promise<void> {
    await this.withLock((state) => {
      state.youtube = tokens;
    });
  }

  async clearTokens(): Promise<void> {
    await this.withLock((state) => {
      state.youtube = null;
    });
  }
}
