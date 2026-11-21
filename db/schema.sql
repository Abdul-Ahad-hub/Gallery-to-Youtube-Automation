-- GoalCast AI — Neon Serverless PostgreSQL Schema (Vercel Blob Storage)
-- Run once with: npm run db:setup

CREATE TABLE IF NOT EXISTS video_queue (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  blob_url TEXT NOT NULL,
  blob_pathname TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 6.0,
  mime_type TEXT NOT NULL DEFAULT 'video/mp4',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'uploaded', 'failed')),
  pipeline_stage TEXT NOT NULL DEFAULT 'queued',
  voice_provider_used TEXT,
  commentary_script TEXT,
  commentary_cues JSONB NOT NULL DEFAULT '[]'::jsonb,
  shorts_title TEXT,
  shorts_description TEXT,
  youtube_video_id TEXT,
  youtube_url TEXT,
  error_message TEXT,
  storage_cleaned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_video_queue_status_created_at
  ON video_queue (status, created_at ASC);

CREATE TABLE IF NOT EXISTS youtube_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  channel_handle TEXT,
  channel_thumbnail_url TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date BIGINT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
