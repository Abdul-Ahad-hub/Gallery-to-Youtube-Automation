import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildCommentaryDuckingFilterGraph,
  buildVerticalShortsFilterGraph,
} from '../../domain/commentary-sync';
import type { IAudioMixer, IVideoFormatter } from '../../interfaces/providers';

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
 * Pure non-AI 9:16 YouTube Shorts video formatter using FFmpeg.
 * Preserves the entire horizontal goal play centered over a Gaussian-blurred background fill.
 */
export class FfmpegShortsFormatter implements IVideoFormatter {
  async formatToVerticalShorts(inputPath: string, outputPath: string): Promise<void> {
    const filterComplex = buildVerticalShortsFilterGraph(1080, 1920);
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-filter_complex',
        filterComplex,
        '-map',
        '[vout]',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '21',
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
 * Pure FFmpeg audio mixer that ducks original stadium/crowd audio under
 * the generated passionate commentary track with zero manual editing.
 */
export class FfmpegAudioMixer implements IAudioMixer {
  async mixVoiceoverWithDucking(
    formattedVideoPath: string,
    voiceoverAudioPath: string,
    finalOutputPath: string
  ): Promise<void> {
    const hasOriginalAudio = await probeHasAudioStream(formattedVideoPath);

    if (hasOriginalAudio) {
      const filterComplex = buildCommentaryDuckingFilterGraph(0.24);
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

    // Clip has no stadium audio track — attach normalized commentary cleanly
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        formattedVideoPath,
        '-i',
        voiceoverAudioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-af',
        'loudnorm=I=-14:TP=-1.5:LRA=9',
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
