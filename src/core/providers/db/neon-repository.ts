import { neon } from '@neondatabase/serverless';
import type {
  CommentaryCue,
  PipelineStage,
  QueueClip,
  StoredYouTubeTokens,
} from '../../domain/types.js';
import type {
  CreateClipInput,
  IChannelRepository,
  IQueueRepository,
} from '../../interfaces/providers.js';

interface VideoQueueRow {
  id: string;
  original_filename: string;
  blob_url: string;
  blob_pathname: string;
  file_size_bytes: string | number;
  duration_sec: number;
  mime_type: string;
  thumbnail_url: string;
  status: QueueClip['status'];
  pipeline_stage: PipelineStage;
  rendered_video_url: string | null;
  voice_provider_used: string | null;
  commentary_script: string | null;
  commentary_cues: CommentaryCue[] | string;
  shorts_title: string | null;
  shorts_description: string | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  error_message: string | null;
  storage_cleaned_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  processed_at: string | Date | null;
}

interface YouTubeRow {
  channel_id: string;
  channel_title: string;
  channel_handle: string | null;
  channel_thumbnail_url: string | null;
  access_token: string;
  refresh_token: string;
  expiry_date: string | number | null;
  connected_at: string | Date;
}

function toIso(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRowToClip(row: VideoQueueRow): QueueClip {
  let cues: CommentaryCue[] = [];
  if (Array.isArray(row.commentary_cues)) {
    cues = row.commentary_cues;
  } else if (typeof row.commentary_cues === 'string') {
    try {
      const parsed = JSON.parse(row.commentary_cues);
      if (Array.isArray(parsed)) cues = parsed;
    } catch {
      cues = [];
    }
  }

  return {
    id: row.id,
    originalFilename: row.original_filename,
    blobUrl: row.blob_url,
    blobPathname: row.blob_pathname,
    fileSizeBytes: Number(row.file_size_bytes),
    durationSec: Number(row.duration_sec),
    mimeType: row.mime_type,
    thumbnailUrl: row.thumbnail_url,
    status: row.status,
    pipelineStage: row.pipeline_stage,
    renderedVideoUrl: row.rendered_video_url ?? null,
    voiceProviderUsed: row.voice_provider_used,
    commentaryScript: row.commentary_script,
    commentaryCues: cues,
    shortsTitle: row.shorts_title,
    shortsDescription: row.shorts_description,
    youtubeVideoId: row.youtube_video_id,
    youtubeUrl: row.youtube_url,
    errorMessage: row.error_message,
    storageCleanedAt: toIso(row.storage_cleaned_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    processedAt: toIso(row.processed_at),
  };
}

export class NeonQueueRepository implements IQueueRepository {
  public readonly providerName = 'neon-postgres' as const;
  private readonly sql: ReturnType<typeof neon>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async listClips(): Promise<QueueClip[]> {
    const rows = (await this.sql`
      SELECT * FROM video_queue
      ORDER BY
        CASE status
          WHEN 'processing' THEN 0
          WHEN 'ready_for_review' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'failed' THEN 3
          ELSE 4
        END,
        created_at ASC
    `) as unknown as VideoQueueRow[];
    return rows.map(mapRowToClip);
  }

  async getClipById(id: string): Promise<QueueClip | null> {
    const rows = (await this.sql`
      SELECT * FROM video_queue WHERE id = ${id} LIMIT 1
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
  }

  async createClip(input: CreateClipInput): Promise<QueueClip> {
    const rows = (await this.sql`
      INSERT INTO video_queue (
        id,
        original_filename,
        blob_url,
        blob_pathname,
        file_size_bytes,
        duration_sec,
        mime_type,
        thumbnail_url,
        status,
        pipeline_stage
      )
      VALUES (
        ${input.id},
        ${input.originalFilename},
        ${input.blobUrl},
        ${input.blobPathname},
        ${input.fileSizeBytes},
        ${input.durationSec},
        ${input.mimeType},
        ${input.thumbnailUrl},
        'pending',
        'queued'
      )
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return mapRowToClip(rows[0]);
  }

  async claimOldestPendingClip(): Promise<QueueClip | null> {
    const rows = (await this.sql`
      UPDATE video_queue
      SET status = 'processing',
          pipeline_stage = 'downloading',
          error_message = NULL,
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM video_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
  }

  async updateStage(id: string, stage: PipelineStage): Promise<QueueClip | null> {
    const rows = (await this.sql`
      UPDATE video_queue
      SET pipeline_stage = ${stage}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
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
    const cuesJson = JSON.stringify(payload.commentaryCues);
    const rows = (await this.sql`
      UPDATE video_queue
      SET shorts_title = ${payload.shortsTitle},
          shorts_description = ${payload.shortsDescription},
          commentary_script = ${payload.commentaryScript},
          commentary_cues = ${cuesJson}::jsonb,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
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
    const rows = (await this.sql`
      UPDATE video_queue
      SET status = 'ready_for_review',
          pipeline_stage = 'awaiting_approval',
          rendered_video_url = ${payload.renderedVideoUrl},
          shorts_title = ${payload.shortsTitle},
          shorts_description = ${payload.shortsDescription},
          voice_provider_used = ${payload.voiceProviderUsed},
          commentary_script = ${payload.commentaryScript},
          error_message = NULL,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
  }

  async claimClipForUpload(id: string): Promise<QueueClip | null> {
    const rows = (await this.sql`
      UPDATE video_queue
      SET status = 'processing',
          pipeline_stage = 'uploading_youtube',
          error_message = NULL,
          updated_at = NOW()
      WHERE id = ${id} AND status = 'ready_for_review'
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
  }

  async requeueClip(id: string): Promise<QueueClip | null> {
    const rows = (await this.sql`
      UPDATE video_queue
      SET status = 'pending',
          pipeline_stage = 'queued',
          rendered_video_url = NULL,
          error_message = NULL,
          updated_at = NOW()
      WHERE id = ${id} AND status IN ('failed', 'ready_for_review')
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
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
    const cuesJson = JSON.stringify(payload.commentaryCues);
    const rows = (await this.sql`
      UPDATE video_queue
      SET status = 'uploaded',
          pipeline_stage = 'completed',
          rendered_video_url = NULL,
          youtube_video_id = ${payload.youtubeVideoId},
          youtube_url = ${payload.youtubeUrl},
          shorts_title = ${payload.shortsTitle},
          shorts_description = ${payload.shortsDescription},
          commentary_script = ${payload.commentaryScript},
          commentary_cues = ${cuesJson}::jsonb,
          voice_provider_used = ${payload.voiceProviderUsed},
          storage_cleaned_at = ${payload.storageCleanedAt},
          error_message = NULL,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
  }

  async markFailed(id: string, errorMessage: string): Promise<QueueClip | null> {
    const rows = (await this.sql`
      UPDATE video_queue
      SET status = 'failed',
          pipeline_stage = 'failed',
          error_message = ${errorMessage},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
  }

  async retryClip(id: string): Promise<QueueClip | null> {
    const rows = (await this.sql`
      UPDATE video_queue
      SET status = 'pending',
          pipeline_stage = 'queued',
          error_message = NULL,
          updated_at = NOW()
      WHERE id = ${id} AND status = 'failed'
      RETURNING *
    `) as unknown as VideoQueueRow[];
    return rows[0] ? mapRowToClip(rows[0]) : null;
  }

  async deleteClip(id: string): Promise<boolean> {
    const rows = (await this.sql`
      DELETE FROM video_queue WHERE id = ${id} RETURNING id
    `) as unknown as Array<{ id: string }>;
    return rows.length > 0;
  }
}

export class NeonChannelRepository implements IChannelRepository {
  private readonly sql: ReturnType<typeof neon>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async getTokens(): Promise<StoredYouTubeTokens | null> {
    const rows = (await this.sql`
      SELECT * FROM youtube_connections WHERE id = 1 LIMIT 1
    `) as unknown as YouTubeRow[];
    const row = rows[0];
    if (!row) return null;

    return {
      channelId: row.channel_id,
      channelTitle: row.channel_title,
      channelHandle: row.channel_handle,
      channelThumbnailUrl: row.channel_thumbnail_url,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiryDate: row.expiry_date !== null ? Number(row.expiry_date) : null,
      connectedAt: toIso(row.connected_at) ?? new Date().toISOString(),
    };
  }

  async saveTokens(tokens: StoredYouTubeTokens): Promise<void> {
    await this.sql`
      INSERT INTO youtube_connections (
        id,
        channel_id,
        channel_title,
        channel_handle,
        channel_thumbnail_url,
        access_token,
        refresh_token,
        expiry_date,
        connected_at,
        updated_at
      )
      VALUES (
        1,
        ${tokens.channelId},
        ${tokens.channelTitle},
        ${tokens.channelHandle},
        ${tokens.channelThumbnailUrl},
        ${tokens.accessToken},
        ${tokens.refreshToken},
        ${tokens.expiryDate},
        ${tokens.connectedAt},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        channel_id = EXCLUDED.channel_id,
        channel_title = EXCLUDED.channel_title,
        channel_handle = EXCLUDED.channel_handle,
        channel_thumbnail_url = EXCLUDED.channel_thumbnail_url,
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(NULLIF(EXCLUDED.refresh_token, ''), youtube_connections.refresh_token),
        expiry_date = EXCLUDED.expiry_date,
        updated_at = NOW()
    `;
  }

  async clearTokens(): Promise<void> {
    await this.sql`DELETE FROM youtube_connections WHERE id = 1`;
  }
}
