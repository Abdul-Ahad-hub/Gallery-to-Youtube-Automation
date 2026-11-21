# GoalCast AI

Minimal automated football Shorts uploader and AI commentary publishing pipeline on a **$0/month** stack (**Vercel + Vercel Blob + Neon PostgreSQL + GitHub Actions + Google Gemini + ElevenLabs / Edge TTS + YouTube Data API v3**).

All setup, environment variable, YouTube OAuth, and GitHub Actions instructions are documented in [`SETUP_INSTRUCTIONS.txt`](./SETUP_INSTRUCTIONS.txt).

## Architecture Overview
- **Storage Provider (`src/core/providers/storage/vercel-blob-storage.ts`)**: Uses `@vercel/blob` client uploads (`upload()` + `/api/upload` `handleUpload()`) to bypass Vercel's 4.5 MB request body limit, and deletes temporary raw videos via `del()` immediately after YouTube confirms the upload.
- **Environment Validation (`src/config/env.ts`)**: Zod-validated configuration using `BLOB_READ_WRITE_TOKEN` (no Cloudflare R2 dependencies).
- **Database (`src/core/providers/db/neon-repository.ts`)**: Neon Serverless PostgreSQL tracking `blob_url`, `blob_pathname`, statuses, AI-written titles/descriptions/scripts, and YouTube OAuth tokens.
- **Automated Worker (`scripts/process-next.ts` + `.github/workflows/upload-short.yml`)**: Runs every Monday, Wednesday, and Friday at `14:00 UTC` (plus manual dispatch), processing the single oldest `PENDING` clip and idling safely when the backlog is empty.
