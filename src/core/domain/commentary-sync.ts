import type {
  CameraKeyframe,
  CommentaryBeatType,
  CommentaryCue,
  GoalAnalysisResult,
} from './types.js';

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

export function normalizeCameraTrack(
  keyframes: CameraKeyframe[] | undefined,
  clipDurationSec: number = DEFAULT_CLIP_DURATION_SEC
): CameraKeyframe[] {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return [];
  }

  const safeDuration = Math.max(1.0, roundTenths(clipDurationSec));
  const cleaned = keyframes
    .filter(
      (kf) =>
        kf !== null &&
        typeof kf === 'object' &&
        Number.isFinite(kf.timeSec) &&
        Number.isFinite(kf.centerX)
    )
    .map((kf) => ({
      timeSec: Math.round(Math.min(safeDuration, Math.max(0, kf.timeSec)) * 100) / 100,
      centerX: Math.round(Math.min(1, Math.max(0, kf.centerX)) * 10000) / 10000,
    }))
    .sort((a, b) => a.timeSec - b.timeSec);

  const deduped: CameraKeyframe[] = [];
  for (const kf of cleaned) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(kf.timeSec - prev.timeSec) < 0.05) {
      deduped[deduped.length - 1] = kf;
    } else {
      deduped.push(kf);
    }
  }

  return deduped.slice(0, 6);
}

export function normalizeGoalAnalysis(
  raw: Omit<GoalAnalysisResult, 'fullScript' | 'cameraTrack'> & {
    cameraTrack?: CameraKeyframe[];
  },
  clipDurationSec: number = DEFAULT_CLIP_DURATION_SEC
): GoalAnalysisResult {
  const cues = normalizeCommentaryCues(raw.cues, clipDurationSec);
  const strikeCue = cues.find((c) => c.beat === 'strike');
  const netCue = cues.find((c) => c.beat === 'net_impact');
  const cameraTrack = normalizeCameraTrack(raw.cameraTrack, clipDurationSec);

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
    cameraTrack,
    fullScript: formatCommentaryScript(cues),
  };
}

function fmtNum(n: number): string {
  return Number(n.toFixed(4)).toString();
}

/**
 * Builds a piecewise-linear FFmpeg `x` crop expression from normalized cameraTrack
 * keyframes (`centerX` in [0, 1]), clamped safely to [0, iw - ow] so the 9:16
 * window never leaves frame bounds. Falls back to centered `(iw-ow)/2` when empty.
 */
export function buildCameraPanExpression(cameraTrack?: CameraKeyframe[]): string {
  const track = normalizeCameraTrack(cameraTrack, 30);
  if (track.length === 0) {
    return '(iw-ow)/2';
  }

  if (track.length === 1) {
    const c = fmtNum(track[0].centerX);
    return `clip(${c}*iw-ow/2,0,iw-ow)`;
  }

  let centerExpr = fmtNum(track[track.length - 1].centerX);
  for (let i = track.length - 2; i >= 0; i--) {
    const k0 = track[i];
    const k1 = track[i + 1];
    const dt = Math.max(0.01, k1.timeSec - k0.timeSec);
    const c0 = fmtNum(k0.centerX);
    const dc = fmtNum(k1.centerX - k0.centerX);
    const t0 = fmtNum(k0.timeSec);
    const t1 = fmtNum(k1.timeSec);
    const dtStr = fmtNum(dt);
    const segExpr = `${c0}+(${dc})*(t-${t0})/${dtStr}`;
    centerExpr = `if(lt(t,${t1}),${segExpr},${centerExpr})`;
  }

  const first = track[0];
  if (first.timeSec > 0) {
    centerExpr = `if(lt(t,${fmtNum(first.timeSec)}),${fmtNum(first.centerX)},${centerExpr})`;
  }

  return `clip((${centerExpr})*iw-ow/2,0,iw-ow)`;
}

/**
 * Full-screen 9:16 YouTube Shorts pan-and-scan FFmpeg video filter chain.
 * Dynamically crops a 9:16 portrait window (`w=ih*9/16`, `h=ih`, `y=0`) that tracks
 * the ball and goal smoothly via `cameraTrack`, then scales cleanly to 1080x1920.
 */
export function buildVerticalShortsFilterGraph(
  cameraTrack?: CameraKeyframe[],
  width: number = TARGET_SHORTS_WIDTH,
  height: number = TARGET_SHORTS_HEIGHT
): string {
  const xExpr = buildCameraPanExpression(cameraTrack);
  return `crop=w='min(iw,ih*9/16)':h='ih':x='${xExpr}':y=0,scale=${width}:${height}:flags=lanczos,setsar=1`;
}

/**
 * Pure FFmpeg audio ducking filter_complex builder.
 * Keeps original stadium/crowd audio audible at `crowdGain` (default 0.25) underneath
 * the passionate commentary voiceover with gentle sidechain compression so the crowd
 * atmosphere stays alive while the commentator cuts through clearly.
 */
export function buildCommentaryDuckingFilterGraph(crowdGain: number = 0.25): string {
  const safeGain = Math.min(0.6, Math.max(0.1, crowdGain));
  return [
    `[0:a]volume=${safeGain.toFixed(2)}[crowd]`,
    `[1:a]loudnorm=I=-14:TP=-1.5:LRA=9,asplit=2[vo_sc][vo_mix]`,
    `[crowd][vo_sc]sidechaincompress=threshold=0.06:ratio=2.5:attack=30:release=250[ducked]`,
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
