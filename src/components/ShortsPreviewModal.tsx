import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Heart,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Share2,
  Sparkles,
  ThumbsDown,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { isSafeYouTubeUrl } from '../core/domain/commentary-sync';
import type { CrowdAudioMode, QueueClip } from '../core/domain/types';
import { fetchClipVariants, getClipPreviewUrl } from '../services/api';

interface ShortsPreviewModalProps {
  clip: QueueClip | null;
  channelHandle?: string | null;
  channelTitle?: string | null;
  approving?: boolean;
  rerendering?: boolean;
  switchingOption?: boolean;
  optionError?: string | null;
  onClose: () => void;
  onApprove?: (clipId: string) => void;
  onRerender?: (clipId: string) => void;
  onRenderOption?: (
    clipId: string,
    payload: { mode: CrowdAudioMode; delayOffsetSec?: number; regenerate?: boolean }
  ) => Promise<CrowdAudioMode[] | undefined>;
}

const AUDIO_OPTIONS: Array<{ id: CrowdAudioMode; label: string; badge?: string }> = [
  { id: 'broadcast-shout-1', label: 'Commentary + "What a strike!"' },
  { id: 'broadcast-shout-2', label: 'Commentary + "GOOOAL!!"' },
  { id: 'broadcast-crowd-only', label: 'Commentary + Crowd Only' },
  { id: 'pure-crowd', label: 'Crowd Only' },
];

const DELAY_NUDGES = [0, 0.2, 0.3, 0.5] as const;

function inferActiveMode(clip: QueueClip | null): CrowdAudioMode {
  const label = (clip?.voiceProviderUsed || '').toLowerCase();
  if (label.startsWith('crowd only')) return 'pure-crowd';
  if (label.includes('crowd roar') || label.includes('crowd only')) return 'broadcast-crowd-only';
  if (label.includes('goooal')) return 'broadcast-shout-2';
  return 'broadcast-shout-1';
}

export function ShortsPreviewModal({
  clip,
  channelHandle,
  channelTitle,
  approving = false,
  rerendering = false,
  switchingOption = false,
  optionError = null,
  onClose,
  onApprove,
  onRerender,
  onRenderOption,
}: ShortsPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(clip?.status !== 'ready_for_review');
  const [panPercent, setPanPercent] = useState(50);
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [activeMode, setActiveMode] = useState<CrowdAudioMode>(() => inferActiveMode(clip));
  const [delayOffsetSec, setDelayOffsetSec] = useState<number>(0.3);
  const [savedVariants, setSavedVariants] = useState<CrowdAudioMode[]>([]);

  const isFinalReview = clip?.status === 'ready_for_review' && Boolean(clip.renderedVideoUrl);

  useEffect(() => {
    setPaused(false);
    setMuted(!isFinalReview);
    setPanPercent(50);
    setActiveMode(inferActiveMode(clip));
  }, [clip?.id, clip?.updatedAt, isFinalReview]);

  useEffect(() => {
    if (!clip || !isFinalReview) {
      setSavedVariants([]);
      return;
    }
    let cancelled = false;
    void fetchClipVariants(clip.id)
      .then((res) => {
        if (!cancelled) setSavedVariants(res.availableVariants);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clip?.id, clip?.updatedAt, isFinalReview]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !clip) return;

    el.muted = !isFinalReview;
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        el.muted = true;
        setMuted(true);
        void el.play().catch(() => {
          setPaused(true);
        });
      });
    }
  }, [clip?.id, clip?.updatedAt, isFinalReview]);

  useEffect(() => {
    if (!clip) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !approving && !switchingOption) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clip, approving, switchingOption, onClose]);

  if (!clip) return null;

  const hasRawSource =
    !clip.storageCleanedAt &&
    (clip.blobUrl.startsWith('https://') ||
      clip.blobUrl.startsWith('http://') ||
      clip.blobUrl.startsWith('local://'));
  const hasStreamableVideo = isFinalReview || hasRawSource;
  const videoStreamUrl = hasStreamableVideo
    ? getClipPreviewUrl(clip.id, isFinalReview ? 'rendered' : 'raw', clip.updatedAt)
    : null;

  const hasSafeYoutube = isSafeYouTubeUrl(clip.youtubeUrl);
  const youtubeEmbedUrl =
    clip.status === 'uploaded' && clip.youtubeVideoId
      ? `https://www.youtube.com/embed/${encodeURIComponent(clip.youtubeVideoId)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(clip.youtubeVideoId)}&playsinline=1`
      : null;

  const displayHandle =
    channelHandle || (channelTitle ? `@${channelTitle.replace(/\s+/g, '')}` : '@GoalCastAI');
  const displayTitle = clip.shortsTitle || `${clip.originalFilename} #Shorts`;

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  };

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const handleSelectOption = async (mode: CrowdAudioMode, regenerate: boolean = false) => {
    if (!onRenderOption || switchingOption || approving) return;
    setActiveMode(mode);
    const updatedVariants = await onRenderOption(clip.id, {
      mode,
      delayOffsetSec: regenerate ? delayOffsetSec : undefined,
      regenerate,
    });
    if (updatedVariants) setSavedVariants(updatedVariants);
  };

  const handleNudgeChange = async (nudge: number) => {
    setDelayOffsetSec(nudge);
    if (!onRenderOption || switchingOption || approving) return;
    const updatedVariants = await onRenderOption(clip.id, {
      mode: activeMode,
      delayOffsetSec: nudge,
      regenerate: true,
    });
    if (updatedVariants) setSavedVariants(updatedVariants);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shorts-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      <div
        className="fixed inset-0 bg-[#0F172A]/85 backdrop-blur-sm"
        onClick={() => {
          if (!approving && !switchingOption) onClose();
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 flex flex-col items-center gap-2.5 max-w-full my-auto">
        {/* Top bar */}
        <div className="w-full max-w-[440px] flex items-center justify-between gap-4 text-white px-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2
                id="shorts-preview-title"
                className="text-sm font-semibold truncate max-w-[220px] sm:max-w-[300px]"
              >
                {isFinalReview ? 'Final Render Preview' : '9:16 YouTube Shorts Preview'}
              </h2>
              {isFinalReview && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-[10px] font-mono font-semibold text-amber-200 whitespace-nowrap">
                  NOT UPLOADED YET
                </span>
              )}
            </div>
            <p className="text-[11px] text-white/70 font-mono truncate mt-0.5">
              {clip.originalFilename}
              {clip.voiceProviderUsed ? ` · ${clip.voiceProviderUsed}` : ' · Full-Res Short'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={approving || switchingOption}
            aria-label="Close 9:16 preview"
            className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 9:16 Portrait Phone Frame */}
        <div className="relative aspect-[9/16] h-[56vh] max-h-[540px] max-w-[90vw] rounded-[24px] overflow-hidden bg-black border-[3px] border-white/15 shadow-2xl select-none">
          {youtubeEmbedUrl ? (
            <iframe
              src={youtubeEmbedUrl}
              title={displayTitle}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          ) : videoStreamUrl ? (
            <video
              ref={videoRef}
              key={videoStreamUrl}
              src={videoStreamUrl}
              autoPlay
              loop
              muted={muted}
              playsInline
              onClick={togglePlay}
              style={isFinalReview ? undefined : { objectPosition: `${panPercent}% 50%` }}
              className={`w-full h-full bg-black cursor-pointer ${
                isFinalReview ? 'object-contain' : 'object-cover'
              }`}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 text-white/75 bg-gradient-to-b from-zinc-900 to-black">
              <p className="text-sm font-semibold text-white">Temporary Video Cleaned Up (0 B)</p>
              <p className="text-xs text-white/60 mt-1.5 leading-relaxed">
                The temporary file was deleted after publishing. Open the published Short on
                YouTube below.
              </p>
            </div>
          )}

          {/* Loading overlay while generating realtime audio option */}
          {switchingOption && (
            <div className="absolute inset-0 bg-black/65 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-white">
              <Loader2 className="w-6 h-6 animate-spin text-[#E5322D]" />
              <span className="text-xs font-semibold">Generating audio version...</span>
            </div>
          )}

          {/* Top-left playback controls */}
          {videoStreamUrl && !youtubeEmbedUrl && (
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-1.5 pointer-events-auto">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={paused ? 'Play preview' : 'Pause preview'}
                  className="w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white inline-flex items-center justify-center backdrop-blur-xs transition-colors"
                >
                  {paused ? (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Pause className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted ? 'Unmute preview' : 'Mute preview'}
                  className="w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white inline-flex items-center justify-center backdrop-blur-xs transition-colors"
                >
                  {muted ? (
                    <VolumeX className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              <span className="px-2 py-0.5 rounded-full bg-black/60 text-[10px] font-mono text-white/95 backdrop-blur-xs">
                {isFinalReview ? 'FINAL RENDER' : 'RAW PREVIEW'}
              </span>
            </div>
          )}

          {/* Subtle YouTube Shorts Safe-Zone Overlay */}
          {showSafeZone && !youtubeEmbedUrl && (
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-end">
              <div className="absolute right-2.5 bottom-20 flex flex-col items-center gap-3 text-white/90 drop-shadow">
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-8 h-8 rounded-full bg-black/35 flex items-center justify-center">
                    <Heart className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[9px] font-medium">12K</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-8 h-8 rounded-full bg-black/35 flex items-center justify-center">
                    <ThumbsDown className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[9px] font-medium">Dislike</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-8 h-8 rounded-full bg-black/35 flex items-center justify-center">
                    <MessageCircle className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[9px] font-medium">248</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-8 h-8 rounded-full bg-black/35 flex items-center justify-center">
                    <Share2 className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[9px] font-medium">Share</span>
                </div>
              </div>

              <div className="pt-12 pb-3.5 px-3.5 pr-12 bg-gradient-to-t from-black/80 via-black/35 to-transparent text-white">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-[#E5322D] text-[9px] font-bold flex items-center justify-center shrink-0">
                    GC
                  </div>
                  <span className="text-xs font-semibold truncate">{displayHandle}</span>
                </div>
                <p className="text-[11px] text-white/95 font-medium mt-1 line-clamp-2 leading-snug">
                  {displayTitle}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Multi-Option Controls */}
        {isFinalReview ? (
          <div className="w-full max-w-[440px] space-y-2.5 bg-white/8 border border-white/15 rounded-2xl p-3 text-white">
            {optionError && (
              <div className="px-3 py-2 rounded-lg bg-red-500/20 border border-red-400/40 text-[11px] text-red-100 leading-snug">
                {optionError}
              </div>
            )}

            {/* Audio Version Switcher (Saved + Realtime) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-white/75">
                <span className="font-semibold text-white">Audio Versions (Click to Switch / Generate)</span>
                <button
                  type="button"
                  onClick={() => setShowSafeZone((v) => !v)}
                  className="text-[10px] underline text-white/75 hover:text-white"
                >
                  {showSafeZone ? 'Hide Shorts UI' : 'Show Shorts UI'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {AUDIO_OPTIONS.map((opt) => {
                  const isActive = activeMode === opt.id;
                  const isSaved = savedVariants.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={switchingOption || approving}
                      onClick={() => void handleSelectOption(opt.id, false)}
                      className={`px-2.5 py-1.5 rounded-lg text-left text-[11px] font-semibold border transition-colors flex items-center justify-between gap-1 disabled:opacity-50 ${
                        isActive
                          ? 'bg-[#E5322D] border-[#E5322D] text-white'
                          : 'bg-white/8 hover:bg-white/15 border-white/15 text-white/90'
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      <span className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/30 text-white/90">
                        {isSaved ? 'SAVED' : opt.badge || 'GEN'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Eruption Timing Nudge + Force Regenerate Realtime */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-white/70 mr-1">Roar Nudge:</span>
                {DELAY_NUDGES.map((nudge) => (
                  <button
                    key={nudge}
                    type="button"
                    disabled={switchingOption || approving}
                    onClick={() => void handleNudgeChange(nudge)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border transition-colors disabled:opacity-50 ${
                      delayOffsetSec === nudge
                        ? 'bg-white text-black border-white'
                        : 'bg-white/10 hover:bg-white/20 text-white border-white/15'
                    }`}
                  >
                    {nudge > 0 ? `+${nudge.toFixed(1)}s` : `${nudge.toFixed(1)}s`}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={switchingOption || approving}
                onClick={() => void handleSelectOption(activeMode, true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-[10px] font-semibold text-white transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                <span>Regenerate Realtime</span>
              </button>
            </div>

            {/* Approve / Re-roll Row */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
              {onRerender && (
                <button
                  type="button"
                  onClick={() => onRerender(clip.id)}
                  disabled={approving || rerendering || switchingOption}
                  className="min-h-[40px] px-3 py-2 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${rerendering ? 'animate-spin' : ''}`} />
                  <span>{rerendering ? 'Re-queuing...' : 'Re-analyze Clip'}</span>
                </button>
              )}

              {onApprove && (
                <button
                  type="button"
                  onClick={() => onApprove(clip.id)}
                  disabled={approving || rerendering || switchingOption}
                  className="flex-1 min-h-[40px] px-4 py-2 inline-flex items-center justify-center gap-2 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-bold shadow-lg transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  {approving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Uploading to YouTube...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>OK — Upload Active Version</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-wrap items-center justify-between gap-3 px-2 text-xs text-white/85">
            {videoStreamUrl && !youtubeEmbedUrl ? (
              <>
                <label className="flex items-center gap-2 text-[11px] text-white/80">
                  <span className="whitespace-nowrap">Pan ({panPercent}%)</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={panPercent}
                    onChange={(e) => setPanPercent(Number(e.target.value))}
                    aria-label="Preview horizontal camera pan"
                    className="w-24 sm:w-28 accent-[#E5322D] cursor-pointer"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setShowSafeZone((v) => !v)}
                  className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[11px] font-medium text-white transition-colors"
                >
                  {showSafeZone ? 'Hide Shorts UI' : 'Show Shorts UI'}
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-white/75">
                {clip.status === 'uploaded' && <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]" />}
                <span>
                  {clip.status === 'uploaded' ? 'Published YouTube Short' : '9:16 Portrait Framing'}
                </span>
              </span>
            )}

            {hasSafeYoutube && (
              <a
                href={clip.youtubeUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E5322D] hover:bg-[#C92420] text-white text-xs font-semibold transition-colors"
              >
                <span>Open on YouTube</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
