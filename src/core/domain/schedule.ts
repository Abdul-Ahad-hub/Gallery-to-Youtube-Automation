import type { ClipStatus, QueueClip } from './types.js';

// Monday (1), Wednesday (3), Friday (5) at 14:00 UTC
export const SCHEDULE_CRON = '0 14 * * 1,3,5';
export const SCHEDULE_DAYS_UTC = [1, 3, 5] as const;
export const SCHEDULE_HOUR_UTC = 14;
export const SCHEDULE_MINUTE_UTC = 0;

/**
 * Computes the next N automated publishing slots on Monday, Wednesday, and Friday at 14:00 UTC.
 */
export function getUpcomingScheduleRuns(fromDate: Date, count: number = 6): Date[] {
  const runs: Date[] = [];
  const cursor = new Date(
    Date.UTC(
      fromDate.getUTCFullYear(),
      fromDate.getUTCMonth(),
      fromDate.getUTCDate(),
      SCHEDULE_HOUR_UTC,
      SCHEDULE_MINUTE_UTC,
      0,
      0
    )
  );

  // If today's 14:00 UTC slot already passed, start checking from tomorrow
  if (cursor.getTime() <= fromDate.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  let guard = 0;
  while (runs.length < count && guard < 60) {
    const day = cursor.getUTCDay();
    if ((SCHEDULE_DAYS_UTC as readonly number[]).includes(day)) {
      runs.push(new Date(cursor.getTime()));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard++;
  }

  return runs;
}

/**
 * Selects the oldest pending clip in strict FIFO order (oldest createdAt first).
 * Returns null when the backlog has no pending clips (worker does nothing).
 */
export function selectNextPendingClip(clips: QueueClip[]): QueueClip | null {
  const pending = clips.filter((clip) => clip.status === 'pending');
  if (pending.length === 0) return null;

  return [...pending].sort((a, b) => {
    const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (delta !== 0) return delta;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Returns a 1-indexed FIFO position map for all pending clips.
 */
export function computePendingQueuePositions(clips: QueueClip[]): Record<string, number> {
  const pending = clips
    .filter((clip) => clip.status === 'pending')
    .sort((a, b) => {
      const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    });

  const positions: Record<string, number> = {};
  pending.forEach((clip, idx) => {
    positions[clip.id] = idx + 1;
  });
  return positions;
}

/**
 * Validates allowed state machine transitions for backlog queue clips.
 */
export function canTransitionClipStatus(from: ClipStatus, to: ClipStatus): boolean {
  const allowed: Record<ClipStatus, ClipStatus[]> = {
    pending: ['processing'],
    processing: ['ready_for_review', 'uploaded', 'failed'],
    ready_for_review: ['processing', 'pending', 'uploaded', 'failed'],
    failed: ['pending'],
    uploaded: [],
  };
  return allowed[from].includes(to);
}

/**
 * Formats byte sizes cleanly for storage tables.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

/**
 * Formats a concise countdown label to the next scheduled publishing slot.
 */
export function formatCountdown(targetIso: string, now: Date = new Date()): string {
  const diffMs = new Date(targetIso).getTime() - now.getTime();
  if (diffMs <= 0) return 'Running soon';

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}
