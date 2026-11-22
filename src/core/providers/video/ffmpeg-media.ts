import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildCommentaryDuckingFilterGraph,
  buildVerticalShortsFilterGraph,
} from '../../domain/commentary-sync.js';
import type { CameraKeyframe } from '../../domain/types.js';
import type { IAudioMixer, IVideoFormatter } from '../../interfaces/providers.js';

const execFileAsync = promisify(execFile);

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function probeHasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        videoPath,
      ],
      { timeout: 10_000 }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function probeVideoDurationSec(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ],
      { timeout: 10_000 }
    );
    const parsed = Number.parseFloat(stdout.trim());
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 10) / 10 : null;
  } catch {
    return null;
  }
}

/**
 * Full-screen 9:16 YouTube Shorts pan-and-scan video formatter using FFmpeg.
 * Dynamically crops a full-height 9:16 portrait window that tracks the ball and
 * goal via piecewise-linear `cameraTrack` interpolation, with zero blurred bars.
 */
export class FfmpegShortsFormatter implements IVideoFormatter {
  async formatToVerticalShorts(
    inputPath: string,
    outputPath: string,
    cameraTrack?: CameraKeyframe[]
  ): Promise<void> {
    const filterChain = buildVerticalShortsFilterGraph(cameraTrack, 1080, 1920);
    console.log(
      '[GoalCast FFmpeg] cameraTrack keyframes:',
      cameraTrack && cameraTrack.length > 0 ? JSON.stringify(cameraTrack) : '[] (centered fallback)'
    );
    console.log('[GoalCast FFmpeg] Dynamic 9:16 crop filter:', filterChain);

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-vf',
        filterChain,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      { timeout: 120_000 }
    );
  }
}

/**
 * Pure FFmpeg audio mixer that keeps stadium/crowd audio alive (volume=0.25) underneath
 * the generated passionate commentary track with gentle sidechain ducking.
 * If the source clip has no audio stream, synthesizes a subtle stadium crowd roar bed.
 */
export class FfmpegAudioMixer implements IAudioMixer {
  async mixVoiceoverWithDucking(
    formattedVideoPath: string,
    voiceoverAudioPath: string,
    finalOutputPath: string
  ): Promise<void> {
    const hasOriginalAudio = await probeHasAudioStream(formattedVideoPath);

    if (hasOriginalAudio) {
      const filterComplex = buildCommentaryDuckingFilterGraph(0.25);
      console.log('[GoalCast FFmpeg] Mixing commentary with original crowd audio (volume=0.25)');
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-i',
          formattedVideoPath,
          '-i',
          voiceoverAudioPath,
          '-filter_complex',
          filterComplex,
          '-map',
          '0:v:0',
          '-map',
          '[aout]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          finalOutputPath,
        ],
        { timeout: 120_000 }
      );
      return;
    }

    // Clip has no stadium audio track — synthesize a warm stadium crowd atmosphere bed
    // behind the normalized commentary so the Short still feels alive.
    const durationSec = (await probeVideoDurationSec(formattedVideoPath)) ?? 6.5;
    const synthCrowdFilter = [
      `anoisesrc=color=pink:sample_rate=44100:duration=${(durationSec + 1).toFixed(1)},highpass=f=160,lowpass=f=2200,aecho=0.8:0.7:45|90:0.4|0.3,volume=0.22[crowd]`,
      `[1:a]loudnorm=I=-14:TP=-1.5:LRA=9,asplit=2[vo_sc][vo_mix]`,
      `[crowd][vo_sc]sidechaincompress=threshold=0.06:ratio=2.5:attack=30:release=250[ducked]`,
      `[ducked][vo_mix]amix=inputs=2:duration=shortest:dropout_transition=2,dynaudnorm[aout]`,
    ].join(';');
    console.log('[GoalCast FFmpeg] No source audio found — mixing commentary with synthetic stadium crowd bed');

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        formattedVideoPath,
        '-i',
        voiceoverAudioPath,
        '-filter_complex',
        synthCrowdFilter,
        '-map',
        '0:v:0',
        '-map',
        '[aout]',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '-movflags',
        '+faststart',
        finalOutputPath,
      ],
      { timeout: 120_000 }
    );
  }
}
