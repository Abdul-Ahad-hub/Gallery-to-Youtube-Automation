import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findDuplicateClip,
  formatDuplicateReason,
  normalizeClipFilename,
} from './duplicate.js';
import type { QueueClip } from './types.js';

function makeClip(overrides: Partial<QueueClip> = {}): QueueClip {
  return {
    id: 'clip-001',
    originalFilename: 'goal_clip.mp4',
    blobUrl: 'https://example.blob.vercel-storage.com/clips/goal_clip.mp4',
    blobPathname: 'clips/goal_clip.mp4',
    fileSizeBytes: 5_000_000,
    contentHash: 'a'.repeat(64),
    durationSec: 6.0,
    mimeType: 'video/mp4',
    thumbnailUrl: '/thumb.jpg',
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
    createdAt: '2026-11-28T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
    processedAt: null,
    ...overrides,
  };
}

test('normalizeClipFilename strips directory paths and normalizes characters', () => {
  assert.equal(normalizeClipFilename('C:\\Videos\\My Goal (1).MP4'), 'my_goal__1_.mp4');
  assert.equal(normalizeClipFilename('/tmp/uploads/clip-99.mov'), 'clip-99.mov');
});

test('findDuplicateClip detects identical contentHash even under a different filename', () => {
  const hash = 'b'.repeat(64);
  const existing = makeClip({ id: 'clip-hash', originalFilename: 'original.mp4', contentHash: hash });
  const match = findDuplicateClip([existing], {
    originalFilename: 'renamed_copy.mp4',
    fileSizeBytes: 5_000_000,
    contentHash: hash.toUpperCase(),
  });
  assert.equal(match?.id, 'clip-hash');
});

test('findDuplicateClip falls back to normalized filename + exact fileSizeBytes for legacy clips', () => {
  const legacy = makeClip({
    id: 'clip-legacy',
    originalFilename: '1000066161.mp4',
    fileSizeBytes: 14_500_123,
    contentHash: null,
  });
  const match = findDuplicateClip([legacy], {
    originalFilename: 'C:\\Downloads\\1000066161.mp4',
    fileSizeBytes: 14_500_123,
    contentHash: 'c'.repeat(64),
  });
  assert.equal(match?.id, 'clip-legacy');
});

test('findDuplicateClip allows clips with same filename when fileSizeBytes and contentHash differ', () => {
  const existing = makeClip({
    id: 'clip-1',
    originalFilename: 'highlight.mp4',
    fileSizeBytes: 5_000_000,
    contentHash: 'd'.repeat(64),
  });
  const match = findDuplicateClip([existing], {
    originalFilename: 'highlight.mp4',
    fileSizeBytes: 6_200_000,
    contentHash: 'e'.repeat(64),
  });
  assert.equal(match, null);
});

test('formatDuplicateReason produces clear user messages per clip status', () => {
  const uploaded = makeClip({ status: 'uploaded', shortsTitle: 'Top Bins! #Shorts' });
  assert.equal(
    formatDuplicateReason('goal.mp4', uploaded),
    '"goal.mp4" was already published to YouTube ("Top Bins! #Shorts") and was skipped.'
  );

  const failed = makeClip({ status: 'failed' });
  assert.equal(
    formatDuplicateReason('goal.mp4', failed),
    '"goal.mp4" is already in your backlog (failed) — retry or remove it instead.'
  );

  const pending = makeClip({ status: 'pending' });
  assert.equal(
    formatDuplicateReason('goal.mp4', pending),
    '"goal.mp4" is already waiting in your backlog queue and was skipped.'
  );
});
