import test from 'node:test';
import assert from 'node:assert/strict';
import { envSchema } from '../../config/env';
import { isAllowedVercelBlobUrl } from '../providers/storage/vercel-blob-storage';
import {
  canTransitionClipStatus,
  computePendingQueuePositions,
  formatFileSize,
  getUpcomingScheduleRuns,
  selectNextPendingClip,
} from './schedule';
import type { QueueClip } from './types';

function makeClip(overrides: Partial<QueueClip>): QueueClip {
  return {
    id: 'clip-1',
    originalFilename: 'goal.mp4',
    blobUrl: 'https://abc123.public.blob.vercel-storage.com/clips/goal.mp4',
    blobPathname: 'clips/goal.mp4',
    fileSizeBytes: 3_200_000,
    durationSec: 6.0,
    mimeType: 'video/mp4',
    thumbnailUrl: '/src/assets/images/goal_top_corner_volley_1795253540408.jpg',
    status: 'pending',
    pipelineStage: 'queued',
    voiceProviderUsed: null,
    commentaryScript: null,
    commentaryCues: [],
    shortsTitle: null,
    shortsDescription: null,
    youtubeVideoId: null,
    youtubeUrl: null,
    errorMessage: null,
    storageCleanedAt: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    processedAt: null,
    ...overrides,
  };
}

test('getUpcomingScheduleRuns returns Mon/Wed/Fri 14:00 UTC slots in chronological order', () => {
  const fromSaturday = new Date('2026-11-21T09:00:00.000Z');
  const runs = getUpcomingScheduleRuns(fromSaturday, 3);

  assert.equal(runs.length, 3);
  assert.equal(runs[0].toISOString(), '2026-11-23T14:00:00.000Z');
  assert.equal(runs[1].toISOString(), '2026-11-25T14:00:00.000Z');
  assert.equal(runs[2].toISOString(), '2026-11-27T14:00:00.000Z');

  const mondayMorning = new Date('2026-11-23T12:00:00.000Z');
  assert.equal(getUpcomingScheduleRuns(mondayMorning, 1)[0].toISOString(), '2026-11-23T14:00:00.000Z');

  const mondayAfternoon = new Date('2026-11-23T15:00:00.000Z');
  assert.equal(getUpcomingScheduleRuns(mondayAfternoon, 1)[0].toISOString(), '2026-11-25T14:00:00.000Z');
});

test('selectNextPendingClip picks strictly oldest pending item and ignores uploaded/failed clips', () => {
  const clips: QueueClip[] = [
    makeClip({ id: 'uploaded-old', status: 'uploaded', createdAt: '2026-11-10T08:00:00.000Z' }),
    makeClip({ id: 'pending-newer', status: 'pending', createdAt: '2026-11-19T08:00:00.000Z' }),
    makeClip({ id: 'pending-oldest', status: 'pending', createdAt: '2026-11-17T08:00:00.000Z' }),
    makeClip({ id: 'failed-older', status: 'failed', createdAt: '2026-11-12T08:00:00.000Z' }),
  ];

  const next = selectNextPendingClip(clips);
  assert.equal(next?.id, 'pending-oldest');

  const positions = computePendingQueuePositions(clips);
  assert.equal(positions['pending-oldest'], 1);
  assert.equal(positions['pending-newer'], 2);
  assert.equal(positions['uploaded-old'], undefined);
});

test('selectNextPendingClip returns null when backlog is empty', () => {
  assert.equal(selectNextPendingClip([]), null);
  assert.equal(selectNextPendingClip([makeClip({ status: 'uploaded' })]), null);
});

test('canTransitionClipStatus enforces valid queue lifecycle transitions', () => {
  assert.equal(canTransitionClipStatus('pending', 'processing'), true);
  assert.equal(canTransitionClipStatus('processing', 'uploaded'), true);
  assert.equal(canTransitionClipStatus('processing', 'failed'), true);
  assert.equal(canTransitionClipStatus('failed', 'pending'), true);
  assert.equal(canTransitionClipStatus('uploaded', 'pending'), false);
  assert.equal(canTransitionClipStatus('pending', 'uploaded'), false);
});

test('formatFileSize formats bytes cleanly', () => {
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(2048), '2.0 KB');
  assert.equal(formatFileSize(4_500_000), '4.29 MB');
});

test('envSchema validates BLOB_READ_WRITE_TOKEN and defaults cleanly', () => {
  const parsed = envSchema.parse({
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token',
    YOUTUBE_PRIVACY_STATUS: 'unlisted',
  });
  assert.equal(parsed.BLOB_READ_WRITE_TOKEN, 'vercel_blob_rw_test_token');
  assert.equal(parsed.YOUTUBE_PRIVACY_STATUS, 'unlisted');
  assert.equal(parsed.PORT, 3000);
});

test('isAllowedVercelBlobUrl permits only HTTPS Vercel Blob storage hosts', () => {
  assert.equal(
    isAllowedVercelBlobUrl('https://store123.public.blob.vercel-storage.com/clips/goal.mp4'),
    true
  );
  assert.equal(isAllowedVercelBlobUrl('http://127.0.0.1:3000/internal'), false);
  assert.equal(isAllowedVercelBlobUrl('https://evil.example.com/goal.mp4'), false);
});
