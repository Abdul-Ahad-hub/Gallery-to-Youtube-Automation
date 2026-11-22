import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clapperboard, LogOut, Play, Plus, Youtube } from 'lucide-react';
import { ClipInspectorDrawer } from './components/ClipInspectorDrawer';
import { QueueTable } from './components/QueueTable';
import { ShortsPreviewModal } from './components/ShortsPreviewModal';
import { UploadHero } from './components/UploadHero';
import { formatCountdown } from './core/domain/schedule';
import type { DashboardSnapshot, QueueClip } from './core/domain/types';
import {
  deleteClip,
  disconnectYouTube,
  fetchDashboard,
  fetchYouTubeAuthUrl,
  retryClip,
  triggerProcessNext,
  uploadClips,
} from './services/api';

type ActivePage = 'upload' | 'backlog';

export default function App() {
  const [activePage, setActivePage] = useState<ActivePage>('upload');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [lastQueuedCount, setLastQueuedCount] = useState<number | null>(null);
  const [processingNext, setProcessingNext] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [connectingYouTube, setConnectingYouTube] = useState(false);
  const [inspectedClipId, setInspectedClipId] = useState<string | null>(null);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await fetchDashboard();
      setSnapshot(data);
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to load backlog.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // Listen for OAuth popup completion via postMessage
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        !origin.endsWith('.vercel.app') &&
        origin !== window.location.origin
      ) {
        return;
      }
      if (event.data?.type === 'GOALCAST_YOUTUBE_CONNECTED') {
        setConnectingYouTube(false);
        setFeedback({
          tone: 'success',
          message: 'YouTube channel connected.',
        });
        void loadDashboard();
      } else if (event.data?.type === 'GOALCAST_YOUTUBE_ERROR') {
        setConnectingYouTube(false);
        setFeedback({
          tone: 'error',
          message: String(event.data.error || 'YouTube authorization failed.'),
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [loadDashboard]);

  const clips = snapshot?.clips ?? [];
  const pendingCount = useMemo(
    () => clips.filter((c) => c.status === 'pending').length,
    [clips]
  );

  const inspectedClip: QueueClip | null = useMemo(() => {
    if (!inspectedClipId) return null;
    return clips.find((c) => c.id === inspectedClipId) ?? null;
  }, [clips, inspectedClipId]);

  const previewClip: QueueClip | null = useMemo(() => {
    if (!previewClipId) return null;
    return clips.find((c) => c.id === previewClipId) ?? null;
  }, [clips, previewClipId]);

  const handleUploadFiles = async (files: File[]) => {
    setUploading(true);
    setUploadProgress({ completed: 0, total: files.length });
    setLastQueuedCount(null);
    setFeedback(null);
    try {
      const uploadMode = snapshot?.uploadMode ?? 'local-preview';
      const result = await uploadClips(files, uploadMode, (completed, total) => {
        setUploadProgress({ completed, total });
      });
      setSnapshot(result.snapshot);
      setLastQueuedCount(result.uploadedCount);
      const newestClip = result.clips[0] ?? result.snapshot.clips[0] ?? null;
      if (newestClip) {
        setActivePage('backlog');
        setPreviewClipId(newestClip.id);
      }
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Upload failed.',
      });
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleRetryClip = async (clipId: string) => {
    setRetryingId(clipId);
    setFeedback(null);
    try {
      const result = await retryClip(clipId);
      setSnapshot(result.snapshot);
      setFeedback({
        tone: 'info',
        message: `Returned "${result.clip.originalFilename}" to Pending.`,
      });
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Could not retry clip.',
      });
    } finally {
      setRetryingId(null);
    }
  };

  const handleDeleteClip = async (clipId: string) => {
    setDeletingId(clipId);
    setFeedback(null);
    try {
      const result = await deleteClip(clipId);
      setSnapshot(result.snapshot);
      if (inspectedClipId === clipId) setInspectedClipId(null);
      if (previewClipId === clipId) setPreviewClipId(null);
      setFeedback({
        tone: 'info',
        message: 'Clip removed from backlog.',
      });
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Could not delete clip.',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleProcessNext = async () => {
    setProcessingNext(true);
    setFeedback(null);
    try {
      const result = await triggerProcessNext();
      setSnapshot(result.snapshot);
      if (!result.processed) {
        setFeedback({ tone: 'info', message: result.message });
      } else if (result.clip?.status === 'uploaded') {
        setFeedback({ tone: 'success', message: result.message });
        setInspectedClipId(result.clip.id);
      } else {
        setFeedback({ tone: 'error', message: result.message });
        if (result.clip) setInspectedClipId(result.clip.id);
      }
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Could not process next clip.',
      });
    } finally {
      setProcessingNext(false);
    }
  };

  const handleConnectYouTube = async () => {
    setConnectingYouTube(true);
    setFeedback(null);
    try {
      const { url } = await fetchYouTubeAuthUrl();
      const popup = window.open(url, 'goalcast_youtube_oauth', 'width=580,height=700');
      if (!popup) {
        setConnectingYouTube(false);
        setFeedback({
          tone: 'error',
          message: 'Allow popups in your browser to authorize YouTube.',
        });
      }
    } catch (err) {
      setConnectingYouTube(false);
      setFeedback({
        tone: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'YouTube OAuth is not configured on this server yet.',
      });
    }
  };

  const handleDisconnectYouTube = async () => {
    setFeedback(null);
    try {
      const result = await disconnectYouTube();
      setSnapshot(result.snapshot);
      setFeedback({ tone: 'info', message: 'YouTube channel disconnected.' });
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to disconnect YouTube.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5FA] text-[#1F2328] flex flex-col">
      {/* Minimal iLovePDF-style Top Navigation Bar */}
      <header className="h-16 bg-white border-b border-[#E5E7EB] sticky top-0 z-30">
        <div className="h-full max-w-6xl mx-auto px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-7 min-w-0">
            <button
              type="button"
              onClick={() => setActivePage('upload')}
              className="flex items-center gap-1.5 sm:gap-2 shrink-0 focus-visible:outline-2 focus-visible:outline-[#E5322D] rounded-md"
            >
              <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#E5322D] text-white flex items-center justify-center shrink-0">
                <Clapperboard className="w-4 h-4" />
              </span>
              <span className="font-display text-lg sm:text-2xl font-bold tracking-tight text-[#1F2328] whitespace-nowrap">
                GoalCast AI
              </span>
            </button>

            <nav aria-label="Primary navigation" className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => setActivePage('upload')}
                className={`min-h-[40px] px-2.5 sm:px-3.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  activePage === 'upload'
                    ? 'text-[#E5322D] bg-[#FFF1F1]'
                    : 'text-[#57606A] hover:text-[#1F2328] hover:bg-[#F5F5FA]'
                }`}
              >
                Upload
              </button>

              <button
                type="button"
                onClick={() => setActivePage('backlog')}
                className={`min-h-[40px] px-2.5 sm:px-3.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                  activePage === 'backlog'
                    ? 'text-[#E5322D] bg-[#FFF1F1]'
                    : 'text-[#57606A] hover:text-[#1F2328] hover:bg-[#F5F5FA]'
                }`}
              >
                <span>Backlog</span>
                <span className="font-mono text-xs tabular-nums text-[#6E7781]">
                  {pendingCount}
                </span>
              </button>
            </nav>
          </div>

          {/* Right: Single YouTube Connection Control */}
          <div className="flex items-center gap-2 shrink-0">
            {snapshot?.channel.connected ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-[#1F2328] max-w-[160px] truncate">
                  <Youtube className="w-4 h-4 text-[#E5322D] shrink-0" />
                  <span className="truncate">
                    {snapshot.channel.channelTitle || 'YouTube Connected'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={handleDisconnectYouTube}
                  aria-label="Disconnect YouTube"
                  className="min-w-[40px] min-h-[40px] px-2.5 sm:px-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-[#57606A] hover:text-[#1F2328] bg-[#F5F5FA] hover:bg-[#ECEEF4] border border-[#E5E7EB] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Disconnect</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleConnectYouTube}
                disabled={connectingYouTube}
                aria-label={connectingYouTube ? 'Connecting YouTube' : 'Connect YouTube'}
                className="min-w-[40px] min-h-[40px] px-2.5 sm:px-4 inline-flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold text-[#1F2328] bg-white hover:bg-[#F5F5FA] border border-[#D1D5DB] rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-[#E5322D]"
              >
                <Youtube className="w-4 h-4 text-[#E5322D] shrink-0" />
                <span className="hidden sm:inline">
                  {connectingYouTube ? 'Connecting...' : 'Connect YouTube'}
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Optional Transient Banner */}
      {feedback && (
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 pt-4">
          <div
            role="status"
            className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl border text-xs sm:text-sm ${
              feedback.tone === 'success'
                ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                : feedback.tone === 'error'
                  ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                  : 'bg-white border-[#E5E7EB] text-[#374151]'
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-xs font-semibold opacity-75 hover:opacity-100 whitespace-nowrap shrink-0 py-1 px-1.5"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Content: Only Upload or Backlog */}
      <main className="flex-1">
        {activePage === 'upload' ? (
          <UploadHero
            uploading={uploading}
            uploadProgress={uploadProgress}
            lastQueuedCount={lastQueuedCount}
            onUploadFiles={handleUploadFiles}
            onOpenBacklog={() => setActivePage('backlog')}
          />
        ) : (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#1F2328]">
                  Backlog
                </h1>
                <p className="text-sm text-[#57606A] mt-1">
                  Publishes 1 Short every Mon, Wed, Fri
                  {snapshot?.nextRunIso ? ` · Next run in ${formatCountdown(snapshot.nextRunIso)}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setActivePage('upload')}
                  className="min-h-[42px] px-4 inline-flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold text-[#1F2328] bg-white hover:bg-[#FAFAFC] border border-[#D1D5DB] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Clips</span>
                </button>

                <button
                  type="button"
                  onClick={handleProcessNext}
                  disabled={processingNext || pendingCount === 0}
                  className="min-h-[42px] px-4 inline-flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold text-white bg-[#E5322D] hover:bg-[#C92420] rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5322D]"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{processingNext ? 'Processing...' : 'Process Next'}</span>
                </button>
              </div>
            </div>

            <QueueTable
              clips={clips}
              loading={loading}
              retryingId={retryingId}
              deletingId={deletingId}
              onInspect={(clip) => setInspectedClipId(clip.id)}
              onPreview={(clip) => setPreviewClipId(clip.id)}
              onRetry={handleRetryClip}
              onDelete={handleDeleteClip}
            />
          </div>
        )}
      </main>

      <ClipInspectorDrawer
        clip={inspectedClip}
        retrying={retryingId === inspectedClip?.id}
        onClose={() => setInspectedClipId(null)}
        onPreview={(clip) => setPreviewClipId(clip.id)}
        onRetry={handleRetryClip}
        onDelete={handleDeleteClip}
      />

      <ShortsPreviewModal
        clip={previewClip}
        channelHandle={snapshot?.channel.channelHandle}
        channelTitle={snapshot?.channel.channelTitle}
        onClose={() => setPreviewClipId(null)}
      />
    </div>
  );
}
