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

const THUMB_VOLLEY = '/src/assets/images/goal_top_corner_volley_1795253540408.jpg';
const THUMB_FREEKICK = '/src/assets/images/goal_freekick_curler_1795253539982.jpg';
const THUMB_COUNTER = '/src/assets/images/goal_counter_breakaway_1795253540648.jpg';

function createSeedClips(): QueueClip[] {
  return [
    {
      id: 'clip-pending-001',
      originalFilename: 'champions_night_half_volley_6s.mp4',
      blobUrl: 'local://clips/clip-pending-001/champions_night_half_volley_6s.mp4',
      blobPathname: 'clips/clip-pending-001/champions_night_half_volley_6s.mp4',
      fileSizeBytes: 4_820_410,
      durationSec: 6.0,
      mimeType: 'video/mp4',
      thumbnailUrl: THUMB_VOLLEY,
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
      createdAt: '2026-11-18T11:20:00.000Z',
      updatedAt: '2026-11-18T11:20:00.000Z',
      processedAt: null,
    },
    {
      id: 'clip-pending-002',
      originalFilename: 'rainy_counter_breakaway_finish_6s.mp4',
      blobUrl: 'local://clips/clip-pending-002/rainy_counter_breakaway_finish_6s.mp4',
      blobPathname: 'clips/clip-pending-002/rainy_counter_breakaway_finish_6s.mp4',
      fileSizeBytes: 3_940_120,
      durationSec: 6.0,
      mimeType: 'video/mp4',
      thumbnailUrl: THUMB_COUNTER,
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
      createdAt: '2026-11-19T16:45:00.000Z',
      updatedAt: '2026-11-19T16:45:00.000Z',
      processedAt: null,
    },
    {
      id: 'clip-uploaded-001',
      originalFilename: 'curling_freekick_top_bins_6s.mp4',
      blobUrl: 'local://clips/clip-uploaded-001/curling_freekick_top_bins_6s.mp4',
      blobPathname: 'clips/clip-uploaded-001/curling_freekick_top_bins_6s.mp4',
      fileSizeBytes: 4_310_880,
      durationSec: 6.0,
      mimeType: 'video/mp4',
      thumbnailUrl: THUMB_FREEKICK,
      status: 'uploaded',
      pipelineStage: 'completed',
      renderedVideoUrl: null,
      voiceProviderUsed: 'ElevenLabs',
      commentaryCues: [
        {
          beat: 'buildup',
          startSec: 0.0,
          endSec: 1.6,
          text: 'Twenty-five yards out—four men in the wall!',
          energy: 'rising',
        },
        {
          beat: 'strike',
          startSec: 1.6,
          endSec: 3.1,
          text: 'Whipped with pure velvet over the jump!',
          energy: 'peak',
        },
        {
          beat: 'net_impact',
          startSec: 3.1,
          endSec: 4.5,
          text: 'OH! STRAIGHT INTO THE TOP STANCHION! UNSTOPPABLE!',
          energy: 'explosive',
        },
        {
          beat: 'celebration',
          startSec: 4.5,
          endSec: 6.0,
          text: 'The keeper could only watch! Pure artistry!',
          energy: 'afterglow',
        },
      ],
      commentaryScript:
        '[0.0s–1.6s] Twenty-five yards out—four men in the wall!\n[1.6s–3.1s] Whipped with pure velvet over the jump!\n[3.1s–4.5s] OH! STRAIGHT INTO THE TOP STANCHION! UNSTOPPABLE!\n[4.5s–6.0s] The keeper could only watch! Pure artistry!',
      shortsTitle: 'UNSTOPPABLE 25-Yard Top-Corner Free Kick! #Shorts',
      shortsDescription:
        'Curled right over the defensive wall and into the postage stamp with zero chance for the goalkeeper.\n\n#Shorts #Football #Soccer #Goal #FreeKick',
      youtubeVideoId: 'dQw4w9WgXcQ',
      youtubeUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      errorMessage: null,
      storageCleanedAt: '2026-11-20T14:01:48.000Z',
      createdAt: '2026-11-15T09:10:00.000Z',
      updatedAt: '2026-11-20T14:01:48.000Z',
      processedAt: '2026-11-20T14:01:45.000Z',
    },
    {
      id: 'clip-uploaded-002',
      originalFilename: 'acrobatic_scissor_volley_6s.mp4',
      blobUrl: 'local://clips/clip-uploaded-002/acrobatic_scissor_volley_6s.mp4',
      blobPathname: 'clips/clip-uploaded-002/acrobatic_scissor_volley_6s.mp4',
      fileSizeBytes: 5_112_900,
      durationSec: 6.0,
      mimeType: 'video/mp4',
      thumbnailUrl: THUMB_VOLLEY,
      status: 'uploaded',
      pipelineStage: 'completed',
      renderedVideoUrl: null,
      voiceProviderUsed: 'Edge TTS',
      commentaryCues: [
        {
          beat: 'buildup',
          startSec: 0.0,
          endSec: 1.7,
          text: 'Lofted cross drops right across the penalty spot!',
          energy: 'rising',
        },
        {
          beat: 'strike',
          startSec: 1.7,
          endSec: 3.2,
          text: 'HE LEAPS—ACROBATIC VOLLEY ON THE TURN!',
          energy: 'peak',
        },
        {
          beat: 'net_impact',
          startSec: 3.2,
          endSec: 4.6,
          text: 'THUNDERBOLT! RIPPLES THE ROOF OF THE NET!',
          energy: 'explosive',
        },
        {
          beat: 'celebration',
          startSec: 4.6,
          endSec: 6.0,
          text: 'Goal of the season contender right there!',
          energy: 'afterglow',
        },
      ],
      commentaryScript:
        '[0.0s–1.7s] Lofted cross drops right across the penalty spot!\n[1.7s–3.2s] HE LEAPS—ACROBATIC VOLLEY ON THE TURN!\n[3.2s–4.6s] THUNDERBOLT! RIPPLES THE ROOF OF THE NET!\n[4.6s–6.0s] Goal of the season contender right there!',
      shortsTitle: 'Acrobatic Mid-Air Volley Into the Roof of the Net! #Shorts',
      shortsDescription:
        'Mid-air timing at its absolute finest under the European floodlights.\n\n#Shorts #Football #Soccer #Goal #Volley',
      youtubeVideoId: 'M7lc1UVf-VE',
      youtubeUrl: 'https://www.youtube.com/shorts/M7lc1UVf-VE',
      errorMessage: null,
      storageCleanedAt: '2026-11-18T14:02:11.000Z',
      createdAt: '2026-11-13T18:30:00.000Z',
      updatedAt: '2026-11-18T14:02:11.000Z',
      processedAt: '2026-11-18T14:02:08.000Z',
    },
    {
      id: 'clip-failed-001',
      originalFilename: 'derby_stoppage_time_chip_6s.mp4',
      blobUrl: 'local://clips/clip-failed-001/derby_stoppage_time_chip_6s.mp4',
      blobPathname: 'clips/clip-failed-001/derby_stoppage_time_chip_6s.mp4',
      fileSizeBytes: 3_620_000,
      durationSec: 6.0,
      mimeType: 'video/mp4',
      thumbnailUrl: THUMB_COUNTER,
      status: 'failed',
      pipelineStage: 'failed',
      renderedVideoUrl: null,
      voiceProviderUsed: null,
      commentaryScript: null,
      commentaryCues: [],
      shortsTitle: null,
      shortsDescription: null,
      youtubeVideoId: null,
      youtubeUrl: null,
      errorMessage:
        'YouTube daily upload quota temporarily reached. Raw clip preserved safely for retry.',
      storageCleanedAt: null,
      createdAt: '2026-11-16T21:15:00.000Z',
      updatedAt: '2026-11-17T14:01:22.000Z',
      processedAt: null,
    },
  ];
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
      // Ensure clean migration if an older preview state file existed before Vercel Blob refactor
      if (parsed.clips.some((c) => !('blobUrl' in c))) {
        throw new Error('Migrate preview store schema');
      }
      return parsed;
    } catch {
      const seeded: LocalStoreFile = {
        clips: createSeedClips(),
        youtube: null,
      };
      await this.writeState(seeded);
      return seeded;
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
