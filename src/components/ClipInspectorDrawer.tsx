import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Film,
  Maximize2,
  PlayCircle,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { isSafeYouTubeUrl } from '../core/domain/commentary-sync';
import { formatFileSize } from '../core/domain/schedule';
import type { CommentaryBeatType, QueueClip } from '../core/domain/types';
import { getClipPreviewUrl } from '../services/api';

interface ClipInspectorDrawerProps {
  clip: QueueClip | null;
  retrying: boolean;
  approving: boolean;
  onClose: () => void;
  onPreview: (clip: QueueClip) => void;
  onApprove: (clipId: string) => void;
  onRetry: (clipId: string) => void;
  onDelete: (clipId: string) => void;
}

const BEAT_LABELS: Record<CommentaryBeatType, string> = {
  buildup: 'Buildup',
  strike: 'Ball Strike',
  net_impact: 'Net Impact',
  celebration: 'Celebration',
};

export function ClipInspectorDrawer({
  clip,
  retrying,
  approving,
  onClose,
  onPreview,
  onApprove,
  onRetry,
  onDelete,
}: ClipInspectorDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    setCopied(false);
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

  const hasSafeYoutube = isSafeYouTubeUrl(clip.youtubeUrl);

  const handleCopyScript = async () => {
    if (!clip.commentaryScript) return;
    try {
      await navigator.clipboard.writeText(clip.commentaryScript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inspector-drawer-title"
      className="fixed inset-0 z-50 flex justify-end"
    >
      <div
        className="fixed inset-0 bg-[#1F2328]/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-xl h-full bg-white border-l border-[#E5E7EB] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-[#E5E7EB]">
          <div className="min-w-0">
            <h2
              id="inspector-drawer-title"
              className="font-display text-2xl font-bold tracking-tight text-[#1F2328] truncate"
            >
              {clip.shortsTitle || clip.originalFilename}
            </h2>
            <p className="text-xs text-[#6E7781] mt-0.5 font-mono tabular-nums truncate">
              {clip.originalFilename} · {clip.durationSec.toFixed(1)}s ·{' '}
              {formatFileSize(clip.fileSizeBytes)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-[#57606A] hover:text-[#1F2328] hover:bg-[#F5F5FA] rounded-lg transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-[148px_1fr] gap-5 items-start">
            <button
              type="button"
              onClick={() => onPreview(clip)}
              aria-label={`Open full 9:16 Shorts preview for ${clip.originalFilename}`}
              className="group w-[140px] sm:w-[148px] aspect-[9/16] rounded-lg overflow-hidden border border-[#E5E7EB] bg-black relative mx-auto sm:mx-0 text-left focus-visible:outline-2 focus-visible:outline-[#E5322D]"
            >
              {clip.renderedVideoUrl ||
              (!clip.storageCleanedAt &&
                (clip.blobUrl.startsWith('https://') ||
                  clip.blobUrl.startsWith('http://') ||
                  clip.blobUrl.startsWith('local://'))) ? (
                <video
                  src={getClipPreviewUrl(
                    clip.id,
                    clip.renderedVideoUrl ? 'rendered' : 'raw',
                    clip.updatedAt
                  )}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className={`w-full h-full ${clip.renderedVideoUrl ? 'object-contain' : 'object-cover'}`}
                />
              ) : clip.thumbnailUrl && !imgFailed ? (
                <img
                  src={clip.thumbnailUrl}
                  alt={`9:16 Shorts preview for ${clip.originalFilename}`}
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#9CA3AF] p-3 text-center">
                  <Film className="w-6 h-6" />
                  <span className="text-[11px]">9:16 Short</span>
                </div>
              )}
              <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white inline-flex items-center justify-center opacity-85 group-hover:opacity-100 transition-opacity">
                <Maximize2 className="w-3 h-3" />
              </div>
              <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                <p className="font-mono text-[10px] text-white tabular-nums">1080×1920 · 9:16</p>
              </div>
            </button>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-[#6E7781]">Status</p>
                {clip.status === 'uploaded' && (
                  <div className="mt-1.5 space-y-3">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-[#16A34A]">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Published on YouTube Shorts</span>
                    </div>
                    {hasSafeYoutube && (
                      <a
                        href={clip.youtubeUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full sm:w-auto min-h-[42px] sm:min-h-[38px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#E5322D] hover:bg-[#C92420] rounded-lg transition-colors whitespace-nowrap"
                      >
                        <span>Watch YouTube Short</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                )}

                {clip.status === 'failed' && (
                  <div className="mt-1.5 space-y-3">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-[#DC2626]">
                      <AlertCircle className="w-4 h-4" />
                      <span>Processing Failed</span>
                    </div>
                    <p className="text-xs text-[#991B1B] leading-relaxed bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-3">
                      {clip.errorMessage || 'An unexpected error occurred during processing.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => onRetry(clip.id)}
                      disabled={retrying}
                      className="w-full sm:w-auto min-h-[42px] sm:min-h-[38px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-[#1F2328] bg-[#F5F5FA] hover:bg-[#ECEEF4] border border-[#D1D5DB] rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#D97706]" />
                      <span>{retrying ? 'Requeuing...' : 'Retry Clip'}</span>
                    </button>
                  </div>
                )}

                {clip.status === 'ready_for_review' && (
                  <div className="mt-1.5 space-y-3">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-[#2563EB]">
                      <PlayCircle className="w-4 h-4" />
                      <span>Ready for Final Preview</span>
                    </div>
                    <p className="text-xs text-[#57606A] leading-relaxed">
                      Not uploaded to YouTube yet. Watch the rendered Short with stadium crowd audio
                      and click OK when ready to publish.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onPreview(clip)}
                        className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] rounded-lg transition-colors whitespace-nowrap"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span>Open Final Preview</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onApprove(clip.id)}
                        disabled={approving}
                        className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{approving ? 'Uploading...' : 'OK — Upload'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {clip.status === 'pending' && (
                  <p className="mt-1 text-sm text-[#57606A]">
                    Queued for processing. We rotate landscape clips to full-res Shorts and mix
                    stadium crowd ambience + goal roar before your final preview.
                  </p>
                )}

                {clip.status === 'processing' && (
                  <p className="mt-1 text-sm text-[#D97706]">
                    Rotating video to full-res Short and mixing stadium crowd audio.
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-[#ECEEF2] grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[#6E7781]">Temporary File</p>
                  <p className="mt-0.5 font-medium text-[#1F2328]">
                    {clip.storageCleanedAt ? 'Deleted · 0 B' : 'Stored until upload'}
                  </p>
                </div>
                <div>
                  <p className="text-[#6E7781]">Audio Track</p>
                  <p className="mt-0.5 font-medium text-[#1F2328]">
                    {clip.voiceProviderUsed || 'Stadium Crowd Mix'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* YouTube Shorts Title & Description */}
          {(clip.shortsTitle || clip.shortsDescription) && (
            <div className="pt-4 border-t border-[#ECEEF2] space-y-2.5">
              <h3 className="font-display text-lg font-bold tracking-tight text-[#1F2328]">
                Shorts Title &amp; Description
              </h3>
              <div className="border border-[#E5E7EB] rounded-lg bg-[#FAFAFC] p-4 space-y-3 text-xs">
                <div>
                  <p className="text-[#6E7781]">Title</p>
                  <p className="text-[#1F2328] font-semibold text-sm mt-0.5">{clip.shortsTitle}</p>
                </div>
                {clip.shortsDescription && (
                  <div className="pt-2.5 border-t border-[#E5E7EB]">
                    <p className="text-[#6E7781]">Description</p>
                    <p className="text-[#374151] mt-1 whitespace-pre-line leading-relaxed">
                      {clip.shortsDescription}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stadium Audio Mix */}
          <div className="pt-4 border-t border-[#ECEEF2] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold tracking-tight text-[#1F2328]">
                  Stadium Audio Mix
                </h3>
                <p className="text-xs text-[#6E7781]">
                  0.0s–5.15s normal crowd ambience + 5.15s–6.0s goal roar burst
                </p>
              </div>
              {clip.commentaryScript && (
                <button
                  type="button"
                  onClick={handleCopyScript}
                  className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1F2328] bg-[#F5F5FA] hover:bg-[#ECEEF4] border border-[#E5E7EB] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copied ? 'Copied' : 'Copy Details'}</span>
                </button>
              )}
            </div>

            {clip.commentaryCues.length > 0 ? (
              <div className="divide-y divide-[#ECEEF2] border border-[#E5E7EB] rounded-lg bg-[#FAFAFC]">
                {clip.commentaryCues.map((cue, idx) => (
                  <div
                    key={`${cue.beat}-${idx}`}
                    className="grid grid-cols-1 sm:grid-cols-[92px_1fr] gap-1 sm:gap-3 px-3.5 py-3 items-start"
                  >
                    <div className="flex items-center gap-2 sm:block sm:space-y-0.5">
                      <p className="font-mono text-xs font-medium tabular-nums text-[#E5322D]">
                        {cue.startSec.toFixed(1)}s–{cue.endSec.toFixed(1)}s
                      </p>
                      <p className="text-[11px] text-[#6E7781]">{BEAT_LABELS[cue.beat]}</p>
                    </div>
                    <p className="text-sm text-[#1F2328] leading-relaxed">{cue.text}</p>
                  </div>
                ))}
              </div>
            ) : clip.commentaryScript ? (
              <div className="border border-[#E5E7EB] rounded-lg bg-[#FAFAFC] px-4 py-3.5 text-xs font-mono text-[#1F2328] whitespace-pre-line leading-relaxed">
                {clip.commentaryScript}
              </div>
            ) : (
              <div className="border border-[#E5E7EB] rounded-lg bg-[#FAFAFC] px-4 py-5 text-xs text-[#6E7781]">
                Stadium crowd ambience (0.0s–4.8s) and goal burst roar (4.8s–6.0s) will be mixed
                automatically when you click Process Next.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {(clip.status === 'pending' ||
          clip.status === 'ready_for_review' ||
          clip.status === 'failed') && (
          <div className="px-5 sm:px-6 py-3.5 border-t border-[#E5E7EB] bg-[#FAFAFC] flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                onDelete(clip.id);
                onClose();
              }}
              className="w-full sm:w-auto min-h-[42px] sm:min-h-[36px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] border border-[#FECACA] rounded-lg transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove Clip</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
