import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Film,
  Loader2,
  PlayCircle,
  RotateCcw,
  Search,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import { isSafeYouTubeUrl } from '../core/domain/commentary-sync';
import { computePendingQueuePositions, formatFileSize } from '../core/domain/schedule';
import type { ClipStatus, PipelineStage, QueueClip } from '../core/domain/types';

type FilterTab = 'all' | ClipStatus;

interface QueueTableProps {
  clips: QueueClip[];
  loading: boolean;
  isAdmin: boolean;
  retryingId: string | null;
  deletingId: string | null;
  approvingId: string | null;
  onInspect: (clip: QueueClip) => void;
  onPreview: (clip: QueueClip) => void;
  onApprove: (clipId: string) => void;
  onRetry: (clipId: string) => void;
  onDelete: (clipId: string) => void;
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  queued: 'Waiting in queue',
  downloading: 'Downloading clip',
  formatting_9_16: 'Rotating full-res Short',
  analyzing_video: 'Preparing metadata',
  generating_crowd_audio: 'Mixing stadium crowd audio',
  synthesizing_voice: 'Preparing stadium audio',
  mixing_audio: 'Muxing crowd audio track',
  awaiting_approval: 'Ready for final preview',
  uploading_youtube: 'Publishing to YouTube',
  cleaning_storage: 'Cleaning temporary file',
  completed: 'Published',
  failed: 'Needs retry',
};

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function ClipThumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="w-9 h-14 rounded-md bg-[#F3F4F6] border border-[#E5E7EB] flex items-center justify-center shrink-0">
        <Film className="w-4 h-4 text-[#9CA3AF]" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-9 h-14 rounded-md object-cover border border-[#E5E7EB] shrink-0 bg-[#F3F4F6]"
    />
  );
}

function StatusDisplay({ clip }: { clip: QueueClip }) {
  if (clip.status === 'uploaded') {
    return (
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#16A34A]">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>Uploaded</span>
      </div>
    );
  }
  if (clip.status === 'ready_for_review') {
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2563EB]">
          <PlayCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Final Preview</span>
        </div>
        <p className="text-[11px] text-[#6B7280]">Waiting for OK</p>
      </div>
    );
  }
  if (clip.status === 'processing') {
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#D97706]">
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          <span>Processing</span>
        </div>
        <p className="text-[11px] text-[#6B7280]">{STAGE_LABELS[clip.pipelineStage]}</p>
      </div>
    );
  }
  if (clip.status === 'failed') {
    return (
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#DC2626]">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>Failed</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#57606A]">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      <span>Pending</span>
    </div>
  );
}

export function QueueTable({
  clips,
  loading,
  isAdmin,
  retryingId,
  deletingId,
  approvingId,
  onInspect,
  onPreview,
  onApprove,
  onRetry,
  onDelete,
}: QueueTableProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const pendingPositions = useMemo(() => computePendingQueuePositions(clips), [clips]);

  const counts = useMemo(() => {
    return {
      all: clips.length,
      pending: clips.filter((c) => c.status === 'pending').length,
      processing: clips.filter((c) => c.status === 'processing').length,
      ready_for_review: clips.filter((c) => c.status === 'ready_for_review').length,
      uploaded: clips.filter((c) => c.status === 'uploaded').length,
      failed: clips.filter((c) => c.status === 'failed').length,
    };
  }, [clips]);

  const filteredClips = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return clips.filter((clip) => {
      if (activeFilter !== 'all' && clip.status !== activeFilter) return false;
      if (!q) return true;
      return (
        clip.originalFilename.toLowerCase().includes(q) ||
        (clip.shortsTitle?.toLowerCase().includes(q) ?? false) ||
        (clip.commentaryScript?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [clips, activeFilter, searchQuery]);

  const filterTabs: Array<{ id: FilterTab; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'pending', label: 'Pending', count: counts.pending },
    { id: 'processing', label: 'Processing', count: counts.processing },
    ...(isAdmin
      ? [{ id: 'ready_for_review' as const, label: 'Review', count: counts.ready_for_review }]
      : []),
    { id: 'uploaded', label: 'Uploaded', count: counts.uploaded },
    { id: 'failed', label: 'Failed', count: counts.failed },
  ];

  return (
    <section
      aria-label="Backlog queue"
      className="bg-white border border-[#E5E7EB] rounded-xl shadow-[0_1px_3px_rgba(16,24,40,0.04)] overflow-hidden"
    >
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3.5 border-b border-[#E5E7EB]">
        <div
          role="tablist"
          aria-label="Filter backlog by status"
          className="flex flex-wrap items-center gap-1 p-1 bg-[#F5F5FA] border border-[#E5E7EB] rounded-lg"
        >
          {filterTabs.map((tab) => {
            const active = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setActiveFilter(tab.id)}
                className={`px-2.5 sm:px-3 py-1.5 min-h-[34px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#E5322D] ${
                  active
                    ? 'bg-white text-[#1F2328] shadow-[0_1px_2px_rgba(16,24,40,0.08)]'
                    : 'text-[#57606A] hover:text-[#1F2328]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="ml-1.5 font-mono text-[11px] tabular-nums text-[#6E7781]">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full md:w-64">
          <label htmlFor="queue-search-input" className="sr-only">
            Search backlog clips
          </label>
          <Search className="w-3.5 h-3.5 text-[#6E7781] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="queue-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search clip or AI title..."
            className="w-full pl-8 pr-3 py-2 sm:py-1.5 text-xs bg-[#F5F5FA] border border-[#E5E7EB] focus:border-[#E5322D] focus:bg-white rounded-lg text-[#1F2328] placeholder:text-[#8C959F] focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Mobile Stacked List (< md) */}
      <div className="md:hidden divide-y divide-[#ECEEF2]">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="p-4 space-y-3 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-9 h-14 rounded-md bg-[#F3F4F6] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-4/5 bg-[#F3F4F6] rounded" />
                  <div className="h-3 w-3/5 bg-[#F5F5FA] rounded" />
                </div>
              </div>
              <div className="h-10 w-full bg-[#F3F4F6] rounded-lg" />
            </div>
          ))
        ) : filteredClips.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <p className="text-sm font-semibold text-[#1F2328]">
              {clips.length === 0 ? 'Your backlog is empty' : 'No clips match this filter'}
            </p>
            <p className="text-xs text-[#6E7781] mt-1">
              {clips.length === 0
                ? 'Upload 6-second football goal clips and AI will handle the rest.'
                : 'Try switching tabs or clearing your search.'}
            </p>
          </div>
        ) : (
          filteredClips.map((clip) => {
            const queuePos = pendingPositions[clip.id];
            const hasSafeYoutube = isSafeYouTubeUrl(clip.youtubeUrl);

            return (
              <div key={clip.id} className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <ClipThumbnail
                    src={clip.thumbnailUrl}
                    alt={`Preview frame for ${clip.originalFilename}`}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-[#1F2328] leading-snug break-words min-w-0">
                        {queuePos && (
                          <span className="font-mono text-xs tabular-nums text-[#E5322D] mr-1.5">
                            #{queuePos}
                          </span>
                        )}
                        {clip.shortsTitle || clip.originalFilename}
                      </p>
                      <div className="shrink-0 pt-0.5">
                        <StatusDisplay clip={clip} />
                      </div>
                    </div>

                    <p className="text-xs text-[#6E7781] font-mono tabular-nums">
                      {clip.durationSec.toFixed(1)}s · {formatFileSize(clip.fileSizeBytes)} ·{' '}
                      <span className={clip.storageCleanedAt ? 'text-[#16A34A]' : 'text-[#6E7781]'}>
                        {clip.storageCleanedAt ? 'Cleaned up' : 'Queued'}
                      </span>
                    </p>

                    {clip.status === 'failed' && clip.errorMessage && (
                      <p className="text-xs text-[#DC2626] leading-relaxed">{clip.errorMessage}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => onPreview(clip)}
                      aria-label={`Preview 9:16 Short for ${clip.originalFilename}`}
                      className={`flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                        clip.status === 'ready_for_review'
                          ? 'text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE]'
                          : 'text-[#1F2328] bg-[#F5F5FA] hover:bg-[#ECEEF4] border border-[#E5E7EB]'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5 text-[#E5322D]" />
                      <span>{clip.status === 'ready_for_review' ? 'Final Preview' : '9:16 Preview'}</span>
                    </button>
                  )}

                  {isAdmin && clip.status === 'ready_for_review' && (
                    <button
                      type="button"
                      onClick={() => onApprove(clip.id)}
                      disabled={approvingId === clip.id}
                      aria-label={`Approve and upload ${clip.originalFilename}`}
                      className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{approvingId === clip.id ? 'Uploading...' : 'OK — Upload'}</span>
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => onInspect(clip)}
                      aria-label={`Inspect ${clip.originalFilename}`}
                      className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#1F2328] bg-[#F5F5FA] hover:bg-[#ECEEF4] border border-[#E5E7EB] rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Details</span>
                    </button>
                  )}

                  {clip.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => onRetry(clip.id)}
                      disabled={retryingId === clip.id}
                      aria-label={`Retry ${clip.originalFilename}`}
                      className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#B45309] bg-[#FFFBEB] hover:bg-[#FEF3C7] border border-[#FDE68A] rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{retryingId === clip.id ? 'Retrying...' : 'Retry'}</span>
                    </button>
                  )}

                  {clip.status === 'uploaded' && hasSafeYoutube && (
                    <a
                      href={clip.youtubeUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Watch YouTube Short for ${clip.originalFilename}`}
                      className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#E5322D] hover:bg-[#C92420] rounded-lg transition-colors whitespace-nowrap"
                    >
                      <span>Watch Short</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}

                  {(clip.status === 'pending' ||
                    clip.status === 'ready_for_review' ||
                    clip.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => onDelete(clip.id)}
                      disabled={deletingId === clip.id}
                      aria-label={`Delete ${clip.originalFilename}`}
                      className="min-w-[42px] min-h-[42px] inline-flex items-center justify-center text-[#6E7781] hover:text-[#DC2626] bg-[#F5F5FA] hover:bg-[#FEF2F2] border border-[#E5E7EB] rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Table (md+) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E5E7EB] bg-[#FAFAFC] text-[11px] font-semibold text-[#6E7781]">
              <th className="py-3 pl-5 pr-3 font-semibold">Clip / AI-Written Title</th>
              <th className="py-3 px-3 font-semibold whitespace-nowrap">Length &amp; Size</th>
              <th className="py-3 px-3 font-semibold whitespace-nowrap">Status</th>
              <th className="py-3 px-3 font-semibold whitespace-nowrap">Storage</th>
              <th className="py-3 px-3 font-semibold whitespace-nowrap">Updated</th>
              <th className="py-3 pl-3 pr-5 font-semibold text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#ECEEF2]">
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <tr key={index} className="animate-pulse">
                  <td className="py-3.5 pl-5 pr-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-14 rounded-md bg-[#F3F4F6]" />
                      <div className="space-y-2">
                        <div className="h-3.5 w-48 bg-[#F3F4F6] rounded" />
                        <div className="h-2.5 w-32 bg-[#F5F5FA] rounded" />
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-3">
                    <div className="h-3.5 w-20 bg-[#F3F4F6] rounded" />
                  </td>
                  <td className="py-3.5 px-3">
                    <div className="h-3.5 w-20 bg-[#F3F4F6] rounded" />
                  </td>
                  <td className="py-3.5 px-3">
                    <div className="h-3.5 w-20 bg-[#F3F4F6] rounded" />
                  </td>
                  <td className="py-3.5 px-3">
                    <div className="h-3.5 w-24 bg-[#F3F4F6] rounded" />
                  </td>
                  <td className="py-3.5 pl-3 pr-5">
                    <div className="h-8 w-24 bg-[#F3F4F6] rounded-lg ml-auto" />
                  </td>
                </tr>
              ))
            ) : filteredClips.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-14 px-4 text-center">
                  <p className="text-sm font-semibold text-[#1F2328]">
                    {clips.length === 0 ? 'Your backlog is empty' : 'No clips match this filter'}
                  </p>
                  <p className="text-xs text-[#6E7781] mt-1">
                    {clips.length === 0
                      ? 'Upload 6-second football goal clips and AI will write the title, description, and commentary.'
                      : 'Try switching status tabs or clearing your search query.'}
                  </p>
                </td>
              </tr>
            ) : (
              filteredClips.map((clip) => {
                const queuePos = pendingPositions[clip.id];
                const hasSafeYoutube = isSafeYouTubeUrl(clip.youtubeUrl);

                return (
                  <tr
                    key={clip.id}
                    className="hover:bg-[#FAFAFC] transition-colors align-middle"
                  >
                    <td className="py-3.5 pl-5 pr-3 min-w-[260px]">
                      <div className="flex items-center gap-3">
                        <ClipThumbnail
                          src={clip.thumbnailUrl}
                          alt={`Preview frame for ${clip.originalFilename}`}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {queuePos && (
                              <span className="font-mono text-xs font-semibold tabular-nums text-[#E5322D] shrink-0">
                                #{queuePos}
                              </span>
                            )}
                            <p className="text-sm font-semibold text-[#1F2328] truncate max-w-[340px]">
                              {clip.shortsTitle || clip.originalFilename}
                            </p>
                          </div>
                          <p className="text-xs text-[#6E7781] mt-0.5 truncate max-w-[360px]">
                            {clip.shortsTitle
                              ? clip.originalFilename
                              : clip.status === 'pending'
                                ? 'Stadium crowd audio + full-res Short'
                                : STAGE_LABELS[clip.pipelineStage]}
                          </p>
                          {clip.status === 'failed' && clip.errorMessage && (
                            <p className="text-xs text-[#DC2626] mt-1 line-clamp-1 max-w-[400px]">
                              {clip.errorMessage}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="font-mono text-xs tabular-nums text-[#1F2328]">
                        {clip.durationSec.toFixed(1)}s
                      </span>
                      <span className="mx-1.5 text-[#D1D5DB]" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-xs tabular-nums text-[#6E7781]">
                        {formatFileSize(clip.fileSizeBytes)}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <StatusDisplay clip={clip} />
                    </td>

                    <td className="py-3.5 px-3 whitespace-nowrap text-xs">
                      {clip.storageCleanedAt ? (
                        <span className="text-[#16A34A] font-medium">Cleaned up</span>
                      ) : (
                        <span className="text-[#6E7781]">Stored</span>
                      )}
                    </td>

                    <td className="py-3.5 px-3 whitespace-nowrap font-mono text-xs tabular-nums text-[#6E7781]">
                      {formatShortDate(clip.processedAt || clip.createdAt)}
                    </td>

                    <td className="py-3.5 pl-3 pr-5 whitespace-nowrap text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => onPreview(clip)}
                            aria-label={`Preview 9:16 Short for ${clip.originalFilename}`}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                              clip.status === 'ready_for_review'
                                ? 'text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE]'
                                : 'text-[#1F2328] bg-[#F5F5FA] hover:bg-[#ECEEF4] border border-[#E5E7EB]'
                            }`}
                          >
                            <Smartphone className="w-3.5 h-3.5 text-[#E5322D]" />
                            <span>{clip.status === 'ready_for_review' ? 'Final Preview' : 'Preview 9:16'}</span>
                          </button>
                        )}

                        {isAdmin && clip.status === 'ready_for_review' && (
                          <button
                            type="button"
                            onClick={() => onApprove(clip.id)}
                            disabled={approvingId === clip.id}
                            aria-label={`Approve and upload ${clip.originalFilename}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>{approvingId === clip.id ? 'Uploading...' : 'OK — Upload'}</span>
                          </button>
                        )}

                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => onInspect(clip)}
                            aria-label={`Inspect ${clip.originalFilename}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-[#1F2328] bg-[#F5F5FA] hover:bg-[#ECEEF4] border border-[#E5E7EB] rounded-lg transition-colors whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Details</span>
                          </button>
                        )}

                        {clip.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => onRetry(clip.id)}
                            disabled={retryingId === clip.id}
                            aria-label={`Retry ${clip.originalFilename}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-[#B45309] bg-[#FFFBEB] hover:bg-[#FEF3C7] border border-[#FDE68A] rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{retryingId === clip.id ? 'Retrying...' : 'Retry'}</span>
                          </button>
                        )}

                        {clip.status === 'uploaded' && hasSafeYoutube && (
                          <a
                            href={clip.youtubeUrl!}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Watch YouTube Short for ${clip.originalFilename}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#E5322D] hover:bg-[#C92420] rounded-lg transition-colors whitespace-nowrap"
                          >
                            <span>Short</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}

                        {(clip.status === 'pending' ||
                          clip.status === 'ready_for_review' ||
                          clip.status === 'failed') && (
                          <button
                            type="button"
                            onClick={() => onDelete(clip.id)}
                            disabled={deletingId === clip.id}
                            aria-label={`Delete ${clip.originalFilename}`}
                            className="p-1.5 text-[#6E7781] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
