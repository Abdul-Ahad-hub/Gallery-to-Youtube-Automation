import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Film,
  HardDrive,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  UploadCloud,
  Youtube,
} from 'lucide-react';
import { isSafeYouTubeUrl } from '../core/domain/commentary-sync';
import { computePendingQueuePositions, formatFileSize } from '../core/domain/schedule';
import type { QueueClip } from '../core/domain/types';

interface BacklogGalleryProps {
  clips: QueueClip[];
  loading: boolean;
  retryingId: string | null;
  deletingId: string | null;
  onAddClips: () => void;
  onRetry: (clipId: string) => void;
  onDelete: (clipId: string) => void;
}

function formatShortDuration(durationSec: number | null | undefined): string | null {
  if (durationSec === null || durationSec === undefined || !Number.isFinite(durationSec)) {
    return null;
  }
  return durationSec >= 10 ? `${Math.round(durationSec)}s` : `${durationSec.toFixed(1)}s`;
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return 'Recently';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isPlayableHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('https://') || url.startsWith('http://');
}

interface PublishedShortCardProps {
  clip: QueueClip;
}

function PublishedShortCard({ clip }: PublishedShortCardProps) {
  const ytThumb = clip.youtubeVideoId
    ? `https://i.ytimg.com/vi/${clip.youtubeVideoId}/hqdefault.jpg`
    : null;
  const fallbackThumb = isPlayableHttpUrl(clip.thumbnailUrl) || clip.thumbnailUrl?.startsWith('data:')
    ? clip.thumbnailUrl
    : null;

  const [imgSrc, setImgSrc] = useState<string | null>(ytThumb ?? fallbackThumb);
  const [imgFailed, setImgFailed] = useState(false);

  const safeYoutubeUrl = isSafeYouTubeUrl(clip.youtubeUrl) ? clip.youtubeUrl! : null;
  const displayTitle = clip.shortsTitle?.trim() || clip.originalFilename;
  const publishedDate = formatShortDate(clip.processedAt || clip.createdAt);
  const storageLabel = clip.storageCleanedAt ? '0 B stored' : formatFileSize(clip.fileSizeBytes);

  const handleImageError = () => {
    if (imgSrc === ytThumb && fallbackThumb && fallbackThumb !== ytThumb) {
      setImgSrc(fallbackThumb);
      return;
    }
    setImgFailed(true);
  };

  return (
    <article className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-shadow flex flex-col">
      <div className="relative aspect-[9/14] bg-[#0F172A] overflow-hidden group">
        {imgSrc && !imgFailed ? (
          <img
            src={imgSrc}
            alt={displayTitle}
            onError={handleImageError}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-[#1E293B] to-[#0F172A] text-white/70 p-4 text-center">
            <Youtube className="w-9 h-9 text-[#E5322D]" />
            <span className="text-xs font-medium text-white/80 line-clamp-2">{displayTitle}</span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/20 pointer-events-none" />

        <div className="absolute top-3 left-3 pointer-events-none">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#ECFDF5]/95 text-[#047857] shadow-xs">
            <Youtube className="w-3 h-3 text-[#E5322D]" />
            Published
          </span>
        </div>

        {safeYoutubeUrl ? (
          <a
            href={safeYoutubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Watch ${displayTitle} on YouTube`}
            className="absolute inset-0 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-white"
          >
            <span className="w-12 h-12 rounded-full bg-[#E5322D]/95 group-hover:bg-[#E5322D] group-hover:scale-105 transition-all flex items-center justify-center shadow-lg">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </span>
          </a>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="w-12 h-12 rounded-full bg-[#E5322D]/85 flex items-center justify-center shadow-lg">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </span>
          </div>
        )}
      </div>

      <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-[#1F2328] line-clamp-2 leading-snug">
            {displayTitle}
          </h3>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#57606A]">
            <span>{publishedDate}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F3F4F6] text-[#374151] font-medium">
              <HardDrive className="w-3 h-3 text-[#6B7280]" />
              {storageLabel}
            </span>
          </div>
        </div>

        {safeYoutubeUrl ? (
          <a
            href={safeYoutubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[38px] px-3 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-white bg-[#E5322D] hover:bg-[#C92420] transition-colors"
          >
            <Youtube className="w-3.5 h-3.5" />
            <span>Watch on YouTube</span>
            <ExternalLink className="w-3 h-3 opacity-85" />
          </a>
        ) : (
          <div className="w-full min-h-[38px] px-3 inline-flex items-center justify-center rounded-lg text-xs font-medium text-[#6B7280] bg-[#F4F5F8] border border-[#E5E7EB]">
            YouTube Link Pending
          </div>
        )}
      </div>
    </article>
  );
}

export function BacklogGallery({
  clips,
  loading,
  retryingId,
  deletingId,
  onAddClips,
  onRetry,
  onDelete,
}: BacklogGalleryProps) {
  const pendingPositions = useMemo(() => computePendingQueuePositions(clips), [clips]);

  const queuedClips = useMemo(() => {
    const waiting = clips.filter(
      (c) => c.status === 'pending' || c.status === 'processing' || c.status === 'ready_for_review',
    );
    return waiting.sort((a, b) => {
      const aActive = a.status === 'processing' || a.status === 'ready_for_review' ? 0 : 1;
      const bActive = b.status === 'processing' || b.status === 'ready_for_review' ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const posA = pendingPositions[a.id] ?? Number.MAX_SAFE_INTEGER;
      const posB = pendingPositions[b.id] ?? Number.MAX_SAFE_INTEGER;
      if (posA !== posB) return posA - posB;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [clips, pendingPositions]);

  const publishedClips = useMemo(() => {
    return clips
      .filter((c) => c.status === 'uploaded')
      .sort((a, b) => {
        const timeA = new Date(a.processedAt || a.createdAt).getTime();
        const timeB = new Date(b.processedAt || b.createdAt).getTime();
        return timeB - timeA;
      });
  }, [clips]);

  const failedClips = useMemo(() => {
    return clips
      .filter((c) => c.status === 'failed')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [clips]);

  if (loading && clips.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((slot) => (
          <div
            key={slot}
            className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden animate-pulse"
          >
            <div className="aspect-[9/14] bg-[#E5E7EB]" />
            <div className="p-3.5 space-y-2">
              <div className="h-4 bg-[#E5E7EB] rounded w-3/4" />
              <div className="h-3 bg-[#F3F4F6] rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-10 text-center max-w-lg mx-auto">
        <div className="w-12 h-12 rounded-xl bg-[#FEF2F2] text-[#E5322D] flex items-center justify-center mx-auto mb-4">
          <UploadCloud className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-semibold text-[#1F2328]">Your backlog is empty</h2>
        <p className="text-sm text-[#57606A] mt-1.5">
          Upload raw gameplay clips to queue them for automated Mon / Wed / Fri Shorts publishing.
        </p>
        <button
          type="button"
          onClick={onAddClips}
          className="mt-5 min-h-[42px] px-5 inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white bg-[#E5322D] hover:bg-[#C92420] transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Upload Clips</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Section 1: Waiting to Publish */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-semibold text-[#1F2328]">
              Waiting to Publish
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#E5E7EB]/80 text-[#374151]">
              {queuedClips.length}
            </span>
          </div>
          <span className="text-xs text-[#57606A]">Auto-publishes in queue order</span>
        </div>

        {queuedClips.length === 0 ? (
          <div className="bg-white border border-dashed border-[#D1D5DB] rounded-xl p-6 text-center text-sm text-[#57606A]">
            No raw clips waiting in queue. Use{' '}
            <button
              type="button"
              onClick={onAddClips}
              className="font-semibold text-[#E5322D] hover:underline"
            >
              Upload Clips
            </button>{' '}
            to add more.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {queuedClips.map((clip) => {
              const queuePos = pendingPositions[clip.id];
              const isProcessing = clip.status === 'processing';
              const isDeleting = deletingId === clip.id;
              const durationLabel = formatShortDuration(clip.durationSec);
              const canStreamVideo = isPlayableHttpUrl(clip.blobUrl);

              return (
                <article
                  key={clip.id}
                  className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-shadow flex flex-col"
                >
                  <div className="relative aspect-[9/14] bg-black overflow-hidden">
                    {canStreamVideo ? (
                      <video
                        src={clip.blobUrl}
                        poster={isPlayableHttpUrl(clip.thumbnailUrl) ? clip.thumbnailUrl! : undefined}
                        controls
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover bg-black"
                      />
                    ) : clip.thumbnailUrl ? (
                      <img
                        src={clip.thumbnailUrl}
                        alt={clip.originalFilename}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-[#1E293B] to-[#0F172A] text-white/65 p-4 text-center">
                        <Film className="w-8 h-8 text-white/50" />
                        <span className="text-xs text-white/70 line-clamp-2">
                          {clip.originalFilename}
                        </span>
                      </div>
                    )}

                    <div className="absolute top-3 left-3 pointer-events-none">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-black/75 text-white backdrop-blur-xs">
                        {queuePos ? `#${queuePos}` : isProcessing ? 'Active' : 'Next'}
                      </span>
                    </div>

                    <div className="absolute top-3 right-3 pointer-events-none">
                      {isProcessing ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF3C7]/95 text-[#B45309]">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Processing
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/90 text-[#374151]">
                          <Clock className="w-3 h-3 text-[#6B7280]" />
                          Queued
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-3.5 flex items-center justify-between gap-2.5">
                    <div className="min-w-0">
                      <p
                        className="text-sm font-semibold text-[#1F2328] truncate"
                        title={clip.originalFilename}
                      >
                        {clip.originalFilename}
                      </p>
                      <p className="text-xs text-[#57606A] mt-0.5">
                        {durationLabel ? `${durationLabel} · ` : ''}
                        {formatFileSize(clip.fileSizeBytes)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onDelete(clip.id)}
                      disabled={isProcessing || isDeleting}
                      title="Remove from queue"
                      aria-label={`Remove ${clip.originalFilename}`}
                      className="p-2 rounded-lg text-[#6B7280] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {isDeleting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Published on YouTube Shorts */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-semibold text-[#1F2328]">
              Published on YouTube Shorts
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#ECFDF5] text-[#047857]">
              {publishedClips.length}
            </span>
          </div>
          <span className="text-xs text-[#57606A]">Source files cleaned up after upload</span>
        </div>

        {publishedClips.length === 0 ? (
          <div className="bg-white border border-dashed border-[#D1D5DB] rounded-xl p-6 text-center text-sm text-[#57606A]">
            No published Shorts yet. Uploaded videos and their YouTube links will appear here.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {publishedClips.map((clip) => (
              <PublishedShortCard key={clip.id} clip={clip} />
            ))}
          </div>
        )}
      </section>

      {/* Section 3: Compact Failed Clips (only shown when failures exist) */}
      {failedClips.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#DC2626]" />
            <h2 className="text-sm font-semibold text-[#991B1B]">
              Needs Attention ({failedClips.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {failedClips.map((clip) => {
              const isRetrying = retryingId === clip.id;
              const isDeleting = deletingId === clip.id;

              return (
                <div
                  key={clip.id}
                  className="bg-[#FEF2F2]/60 border border-[#FECACA] rounded-xl p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1F2328] truncate">
                      {clip.originalFilename}
                    </p>
                    <p className="text-xs text-[#B91C1C] mt-0.5 line-clamp-2">
                      {clip.errorMessage || 'Upload failed during automated processing.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onRetry(clip.id)}
                      disabled={isRetrying || isDeleting}
                      className="min-h-[34px] px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold bg-white border border-[#FCA5A5] text-[#991B1B] hover:bg-[#FEE2E2] transition-colors disabled:opacity-50"
                    >
                      {isRetrying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      <span>Retry</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDelete(clip.id)}
                      disabled={isRetrying || isDeleting}
                      aria-label={`Remove ${clip.originalFilename}`}
                      className="p-2 rounded-lg text-[#991B1B] hover:bg-[#FEE2E2] transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
