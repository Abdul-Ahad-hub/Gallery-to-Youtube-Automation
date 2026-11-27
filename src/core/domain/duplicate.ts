import type { QueueClip } from './types.js';

export interface DuplicateCandidate {
  originalFilename: string;
  fileSizeBytes: number;
  contentHash?: string | null;
}

export function normalizeClipFilename(rawName: string): string {
  const parts = rawName.split(/[\\/]/);
  const basename = parts[parts.length - 1] || '';
  const sanitized = basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120).toLowerCase();
  return sanitized || 'goal_clip.mp4';
}

export function findDuplicateClip(
  existingClips: QueueClip[],
  candidate: DuplicateCandidate
): QueueClip | null {
  const normalizedHash = candidate.contentHash?.trim().toLowerCase() || null;
  if (normalizedHash) {
    const hashMatch = existingClips.find(
      (clip) => clip.contentHash?.trim().toLowerCase() === normalizedHash
    );
    if (hashMatch) return hashMatch;
  }

  const targetName = normalizeClipFilename(candidate.originalFilename);
  return (
    existingClips.find(
      (clip) =>
        normalizeClipFilename(clip.originalFilename) === targetName &&
        clip.fileSizeBytes === candidate.fileSizeBytes
    ) ?? null
  );
}

export function formatDuplicateReason(filename: string, existing: QueueClip): string {
  if (existing.status === 'uploaded') {
    const titleSuffix = existing.shortsTitle ? ` ("${existing.shortsTitle}")` : '';
    return `"${filename}" was already published to YouTube${titleSuffix} and was skipped.`;
  }
  if (existing.status === 'failed') {
    return `"${filename}" is already in your backlog (failed) — retry or remove it instead.`;
  }
  return `"${filename}" is already waiting in your backlog queue and was skipped.`;
}
