import { useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  Heart,
  MessageCircle,
  Pause,
  Play,
  Share2,
  ThumbsDown,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { isSafeYouTubeUrl } from '../core/domain/commentary-sync';
import type { QueueClip } from '../core/domain/types';

interface ShortsPreviewModalProps {
  clip: QueueClip | null;
  channelHandle?: string | null;
  channelTitle?: string | null;
  onClose: () => void;
}

export function ShortsPreviewModal({
  clip,
  channelHandle,
  channelTitle,
  onClose,
}: ShortsPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [panPercent, setPanPercent] = useState(50);
  const [showSafeZone, setShowSafeZone] = useState(true);

  useEffect(() => {
    setPaused(false);
    setMuted(true);
    setPanPercent(50);
  }, [clip?.id]);

  useEffect(() => {
    if (!clip) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clip, onClose]);

  if (!clip) return null;

  const hasLiveBlobVideo =
    !clip.storageCleanedAt &&
    (clip.blobUrl.startsWith('https://') || clip.blobUrl.startsWith('http://'));
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shorts-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0 bg-[#0F172A]/75 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 flex flex-col items-center gap-3 max-w-full">
        {/* Top bar */}
        <div className="w-full flex items-center justify-between gap-4 text-white px-1">
          <div className="min-w-0">
            <h2
              id="shorts-preview-title"
              className="text-sm font-semibold truncate max-w-[260px] sm:max-w-[340px]"
            >
              9:16 YouTube Shorts Preview
            </h2>
            <p className="text-[11px] text-white/70 font-mono truncate">
              {clip.originalFilename} · 1080×1920 Portrait
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close 9:16 preview"
            className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 9:16 Portrait Phone Frame */}
        <div className="relative aspect-[9/16] h-[74vh] max-h-[680px] max-w-[90vw] rounded-[26px] overflow-hidden bg-black border-[3px] border-white/15 shadow-2xl select-none">
          {youtubeEmbedUrl ? (
            <iframe
              src={youtubeEmbedUrl}
              title={displayTitle}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          ) : hasLiveBlobVideo ? (
            <video
              ref={videoRef}
              src={clip.blobUrl}
              autoPlay
              loop
              muted={muted}
              playsInline
              onClick={togglePlay}
              style={{ objectPosition: `${panPercent}% 50%` }}
              className="w-full h-full object-cover cursor-pointer"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 text-white/75 bg-gradient-to-b from-zinc-900 to-black">
              <p className="text-sm font-semibold text-white">Raw Blob Cleaned Up (0 B)</p>
              <p className="text-xs text-white/60 mt-1.5 leading-relaxed">
                The temporary video was deleted after publishing. Open the published Short on
                YouTube below.
              </p>
            </div>
          )}

          {/* Top-left playback controls for Blob video */}
          {hasLiveBlobVideo && !youtubeEmbedUrl && (
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-1.5 pointer-events-auto">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={paused ? 'Play preview' : 'Pause preview'}
                  className="w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white inline-flex items-center justify-center backdrop-blur-xs transition-colors"
                >
                  {paused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted ? 'Unmute preview' : 'Mute preview'}
                  className="w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white inline-flex items-center justify-center backdrop-blur-xs transition-colors"
                >
                  {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
              </div>

              <span className="px-2 py-0.5 rounded-full bg-black/55 text-[10px] font-mono text-white/90 backdrop-blur-xs">
                9:16 FULL-SCREEN
              </span>
            </div>
          )}

          {/* Subtle YouTube Shorts Safe-Zone Overlay */}
          {showSafeZone && !youtubeEmbedUrl && (
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-end">
              {/* Right-side Shorts action rail */}
              <div className="absolute right-2.5 bottom-24 flex flex-col items-center gap-4 text-white/90 drop-shadow">
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-9 h-9 rounded-full bg-black/35 flex items-center justify-center">
                    <Heart className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-medium">12K</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-9 h-9 rounded-full bg-black/35 flex items-center justify-center">
                    <ThumbsDown className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-medium">Dislike</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-9 h-9 rounded-full bg-black/35 flex items-center justify-center">
                    <MessageCircle className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-medium">248</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-9 h-9 rounded-full bg-black/35 flex items-center justify-center">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-medium">Share</span>
                </div>
              </div>

              {/* Bottom Shorts handle & title safe-zone */}
              <div className="pt-14 pb-4 px-3.5 pr-14 bg-gradient-to-t from-black/80 via-black/35 to-transparent text-white">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#E5322D] text-[10px] font-bold flex items-center justify-center shrink-0">
                    GC
                  </div>
                  <span className="text-xs font-semibold truncate">{displayHandle}</span>
                  <span className="px-2 py-0.5 rounded-full bg-white text-black text-[10px] font-semibold">
                    Subscribe
                  </span>
                </div>
                <p className="text-xs text-white/95 font-medium mt-1.5 line-clamp-2 leading-snug">
                  {displayTitle}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Controls: Pan test slider + Safe-zone toggle + YouTube link */}
        <div className="w-full flex flex-wrap items-center justify-between gap-3 px-2 text-xs text-white/85">
          {hasLiveBlobVideo && !youtubeEmbedUrl ? (
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
            <span className="text-[11px] text-white/65">
              {clip.status === 'uploaded' ? 'Published YouTube Short' : '9:16 Portrait Framing'}
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
      </div>
    </div>
  );
}
