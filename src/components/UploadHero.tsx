import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2, Upload } from 'lucide-react';

interface UploadHeroProps {
  uploading: boolean;
  uploadProgress: { completed: number; total: number } | null;
  lastQueuedCount: number | null;
  onUploadFiles: (files: File[]) => Promise<void>;
  onOpenBacklog: () => void;
}

export function UploadHero({
  uploading,
  uploadProgress,
  lastQueuedCount,
  onUploadFiles,
  onOpenBacklog,
}: UploadHeroProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) return;
    const files = Array.from(fileList);
    await onUploadFiles(files);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <section
      aria-label="Upload football goal clips"
      onDragEnter={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDragging) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (e.currentTarget === e.target) {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className={`min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-5 py-12 sm:py-16 transition-colors ${
        isDragging ? 'bg-[#FFF1F1]' : 'bg-[#F5F5FA]'
      }`}
    >
      <div
        className={`w-full max-w-2xl mx-auto text-center rounded-2xl px-5 py-10 sm:px-10 sm:py-14 transition-all ${
          isDragging
            ? 'border-2 border-dashed border-[#E5322D] bg-white/90'
            : 'border-2 border-dashed border-transparent'
        }`}
      >
        <input
          ref={inputRef}
          id="upload-clip-input"
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
        />

        <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-tight text-[#1F2328] text-balance leading-[1.06]">
          Upload football goal clips
        </h1>

        <p className="mt-4 text-base sm:text-lg text-[#57606A] max-w-xl mx-auto leading-relaxed">
          Drop your 6-second goal clips. GoalCast AI rotates them losslessly, mixes stadium crowd
          and commentary, publishes to YouTube Shorts, and cleans up storage automatically.
        </p>

        <div className="mt-9 sm:mt-10 flex flex-col items-center">
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="w-full sm:w-auto min-w-[270px] sm:min-w-[330px] min-h-[68px] sm:min-h-[76px] px-8 sm:px-12 inline-flex items-center justify-center gap-3 text-lg sm:text-xl font-bold text-white bg-[#E5322D] hover:bg-[#C92420] active:bg-[#B31D19] rounded-xl shadow-[0_8px_24px_rgba(229,50,45,0.28)] hover:shadow-[0_10px_28px_rgba(229,50,45,0.34)] transition-all cursor-pointer disabled:opacity-65 disabled:cursor-not-allowed whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E5322D]"
          >
            {uploading ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin shrink-0" />
                <span>
                  {uploadProgress && uploadProgress.total > 1
                    ? `Uploading ${uploadProgress.completed} of ${uploadProgress.total}...`
                    : 'Uploading clips...'}
                </span>
              </>
            ) : (
              <>
                <Upload className="w-6 h-6 shrink-0" />
                <span>Select video clips</span>
              </>
            )}
          </button>

          <p className="mt-4 text-sm text-[#6E7781]">
            {isDragging
              ? 'Release to add clips to your Shorts backlog'
              : 'or drop MP4, MOV, or WebM clips anywhere here'}
          </p>
        </div>

        {lastQueuedCount !== null && lastQueuedCount > 0 && !uploading && (
          <div
            role="status"
            className="mt-8 inline-flex flex-col sm:flex-row items-center gap-3 sm:gap-4 px-5 py-3.5 bg-white border border-[#E5E7EB] rounded-xl shadow-[0_1px_4px_rgba(16,24,40,0.06)]"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-[#1F2328]">
              <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
              <span>
                {lastQueuedCount} {lastQueuedCount === 1 ? 'clip' : 'clips'} added to backlog
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenBacklog}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold text-[#E5322D] hover:text-[#B31D19] hover:bg-[#FFF1F1] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>View Backlog</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
