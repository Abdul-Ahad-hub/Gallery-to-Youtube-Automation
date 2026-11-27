import 'dotenv/config';
import { getAppContainer } from '../src/core/container.js';

/**
 * Standalone Automated Worker Entrypoint (executed by GitHub Actions Mon/Wed/Fri).
 * Claims the single oldest PENDING clip from Neon PostgreSQL, downloads the raw video
 * from Vercel Blob, runs FFmpeg 9:16 formatting + Gemini AI understanding/title/description/script
 * + ElevenLabs/Edge TTS voiceover + stadium audio ducking + YouTube Shorts upload,
 * and immediately deletes the temporary file from Vercel Blob via del() upon upload confirmation.
 */
async function main(): Promise<void> {
  console.log('[GoalCast Worker] Checking backlog for oldest pending clip...');
  const container = getAppContainer();
  const outcome = await container.orchestrator.processOldestPendingClip();

  if (!outcome.processed) {
    console.log(`[GoalCast Worker] ${outcome.message}`);
    process.exit(0);
  }

  if (outcome.clip?.status === 'ready_for_review') {
    console.log(`[GoalCast Worker] Ready for preview: ${outcome.message}`);
    process.exit(0);
  }

  if (outcome.clip?.status === 'uploaded') {
    console.log(`[GoalCast Worker] Success: ${outcome.message}`);
    console.log(`[GoalCast Worker] YouTube Short URL: ${outcome.clip.youtubeUrl}`);
    process.exit(0);
  }

  console.error(`[GoalCast Worker] Clip failed: ${outcome.message}`);
  process.exit(1);
}

main().catch((error) => {
  console.error('[GoalCast Worker] Fatal error:', error);
  process.exit(1);
});
