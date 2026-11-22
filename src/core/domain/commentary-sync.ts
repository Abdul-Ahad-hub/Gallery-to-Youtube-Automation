import type { CommentaryBeatType, CommentaryCue, GoalAnalysisResult } from './types.js';

export const TARGET_SHORTS_WIDTH = 1080;
export const TARGET_SHORTS_HEIGHT = 1920;
export const MAX_SHORTS_TITLE_LENGTH = 100;
export const DEFAULT_CLIP_DURATION_SEC = 6.0;
export const MAX_WORDS_PER_SECOND = 3.4;

const BEAT_ORDER: readonly CommentaryBeatType[] = [
  'buildup',
  'strike',
  'net_impact',
  'celebration',
] as const;

export function roundTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Ensures the YouTube Shorts title always includes #Shorts and respects the
 * 100-character YouTube Data API title limit.
 */
export function normalizeShortsTitle(rawTitle: string): string {
  const cleaned = rawTitle.replace(/\s+/g, ' ').trim();
  const base = cleaned.length > 0 ? cleaned : 'Unstoppable Football Goal!';
  const hasShortsTag = /#shorts\b/i.test(base);

  if (hasShortsTag) {
    return base.length <= MAX_SHORTS_TITLE_LENGTH
      ? base
      : `${base.slice(0, MAX_SHORTS_TITLE_LENGTH - 8).trimEnd()} #Shorts`;
  }

  const suffix = ' #Shorts';
  const maxBaseLength = MAX_SHORTS_TITLE_LENGTH - suffix.length;
  const trimmedBase =
    base.length <= maxBaseLength ? base : `${base.slice(0, maxBaseLength - 1).trimEnd()}…`;
  return `${trimmedBase}${suffix}`;
}

/**
 * Ensures the YouTube Shorts description always includes #Shorts and relevant football tags.
 */
export function normalizeShortsDescription(rawDescription: string, tags: string[] = []): string {
  const cleaned = rawDescription.trim();
  const base =
    cleaned.length > 0
      ? cleaned
      : 'Pure matchday magic! Watch this clinical finish with live AI broadcast commentary.';
  const normalizedTags = Array.from(
    new Set(
      ['#Shorts', '#Football', '#Soccer', '#Goal', ...tags.map((t) => (t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`))]
        .filter((t) => t.length > 1)
    )
  );

  const missingTags = normalizedTags.filter(
    (tag) => !new RegExp(`${tag.replace('#', '#')}\\b`, 'i').test(base)
  );

  return missingTags.length > 0 ? `${base}\n\n${missingTags.join(' ')}` : base;
}

/**
 * Validates and clamps timestamped commentary cues so they are strictly monotonic,
 * non-overlapping, stay within [0, clipDurationSec], and stay within speakable word limits.
 */
export function normalizeCommentaryCues(
  cues: CommentaryCue[],
  clipDurationSec: number = DEFAULT_CLIP_DURATION_SEC
): CommentaryCue[] {
  const safeDuration = Math.max(2.0, roundTenths(clipDurationSec));
  if (!Array.isArray(cues) || cues.length === 0) {
    return buildDefaultSyncCues(safeDuration);
  }

  const sorted = [...cues].sort((a, b) => {
    if (a.startSec !== b.startSec) return a.startSec - b.startSec;
    return BEAT_ORDER.indexOf(a.beat) - BEAT_ORDER.indexOf(b.beat);
  });

  const normalized: CommentaryCue[] = [];
  let cursor = 0;

  for (let i = 0; i < sorted.length; i++) {
    const cue = sorted[i];
    const remainingSlots = sorted.length - i;
    const minSlotDuration = 0.5;
    const maxAllowedStart = Math.max(0, safeDuration - remainingSlots * minSlotDuration);

    const startSec = roundTenths(Math.min(Math.max(cursor, cue.startSec), maxAllowedStart));
    const desiredEnd = cue.endSec > startSec ? cue.endSec : startSec + minSlotDuration;
    const maxAllowedEnd =
      i === sorted.length - 1
        ? safeDuration
        : roundTenths(safeDuration - (remainingSlots - 1) * minSlotDuration);
    const endSec = roundTenths(
      Math.min(Math.max(startSec + minSlotDuration, desiredEnd), maxAllowedEnd)
    );

    const slotDuration = Math.max(0.5, endSec - startSec);
    const maxWords = Math.max(3, Math.floor(slotDuration * MAX_WORDS_PER_SECOND));
    const words = cue.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const trimmedText =
      words.length <= maxWords ? words.join(' ') : `${words.slice(0, maxWords).join(' ')}!`;

    normalized.push({
      beat: cue.beat,
      startSec,
      endSec,
      text: trimmedText,
      energy: cue.energy,
    });

    cursor = endSec;
  }

  return normalized;
}

export function buildDefaultSyncCues(clipDurationSec: number = DEFAULT_CLIP_DURATION_SEC): CommentaryCue[] {
  const d = Math.max(4.0, roundTenths(clipDurationSec));
  return [
    {
      beat: 'buildup',
      startSec: 0.0,
      endSec: roundTenths(d * 0.3),
      text: 'Space opens up on the edge of the box!',
      energy: 'rising',
    },
    {
      beat: 'strike',
      startSec: roundTenths(d * 0.3),
      endSec: roundTenths(d * 0.55),
      text: 'He lets fly with thunderous power!',
      energy: 'peak',
    },
    {
      beat: 'net_impact',
      startSec: roundTenths(d * 0.55),
      endSec: roundTenths(d * 0.78),
      text: 'GOAL! Straight into the top corner!',
      energy: 'explosive',
    },
    {
      beat: 'celebration',
      startSec: roundTenths(d * 0.78),
      endSec: d,
      text: 'Absolute pandemonium in the stands!',
      energy: 'afterglow',
    },
  ];
}

export function formatCommentaryScript(cues: CommentaryCue[]): string {
  return cues
    .map((cue) => `[${cue.startSec.toFixed(1)}s–${cue.endSec.toFixed(1)}s] ${cue.text}`)
    .join('\n');
}

export function normalizeGoalAnalysis(
  raw: Omit<GoalAnalysisResult, 'fullScript'>,
  clipDurationSec: number = DEFAULT_CLIP_DURATION_SEC
): GoalAnalysisResult {
  const cues = normalizeCommentaryCues(raw.cues, clipDurationSec);
  const strikeCue = cues.find((c) => c.beat === 'strike');
  const netCue = cues.find((c) => c.beat === 'net_impact');

  return {
    summary: raw.summary.trim() || 'Clinical football finish captured in 6 seconds.',
    strikeTimestampSec: roundTenths(
      Math.min(clipDurationSec, Math.max(0, raw.strikeTimestampSec ?? strikeCue?.startSec ?? 1.8))
    ),
    netImpactTimestampSec: roundTenths(
      Math.min(clipDurationSec, Math.max(0, raw.netImpactTimestampSec ?? netCue?.startSec ?? 3.2))
    ),
    shortsTitle: normalizeShortsTitle(raw.shortsTitle),
    shortsDescription: normalizeShortsDescription(raw.shortsDescription, raw.tags),
    tags: Array.from(new Set(['Shorts', 'Football', 'Soccer', 'Goal', ...(raw.tags ?? [])])).slice(0, 10),
    cues,
    fullScript: formatCommentaryScript(cues),
  };
}

/**
 * Pure non-AI FFmpeg filter_complex builder for 9:16 YouTube Shorts formatting.
 * Centers the original goal action without cropping any play width, filling top/bottom
 * with a smoothly scaled, cropped, Gaussian-blurred background of the same footage.
 */
export function buildVerticalShortsFilterGraph(
  width: number = TARGET_SHORTS_WIDTH,
  height: number = TARGET_SHORTS_HEIGHT
): string {
  return [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:6,eq=brightness=-0.06:saturation=1.1[bg]`,
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[vout]`,
  ].join(';');
}

/**
 * Pure FFmpeg audio ducking filter_complex builder.
 * Lowers original stadium/crowd audio cleanly underneath the commentary voiceover
 * using gentle gain reduction + sidechain compression so the commentator stands out.
 */
export function buildCommentaryDuckingFilterGraph(crowdGain: number = 0.24): string {
  const safeGain = Math.min(0.5, Math.max(0.08, crowdGain));
  return [
    `[0:a]volume=${safeGain.toFixed(2)}[crowd]`,
    `[1:a]loudnorm=I=-14:TP=-1.5:LRA=9,asplit=2[vo_sc][vo_mix]`,
    `[crowd][vo_sc]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=220[ducked]`,
    `[ducked][vo_mix]amix=inputs=2:duration=first:dropout_transition=2,dynaudnorm[aout]`,
  ].join(';');
}

/**
 * Validates that a YouTube URL uses an allowed https://youtube.com or https://www.youtube.com origin.
 */
export function isSafeYouTubeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'youtube.com' ||
        parsed.hostname === 'www.youtube.com' ||
        parsed.hostname === 'youtu.be')
    );
  } catch {
    return false;
  }
}
