import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildCommentaryDuckingFilterGraph,
  buildLandscapeRotationFilter,
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

/**
 * Creates a lightweight ~150 KB muted proxy MP4 (360px wide, 2 fps) so Gemini
 * can inspect visual action & timing quickly without hitting inline payload timeouts.
 */
export async function createGeminiPreviewProxy(
  inputPath: string,
  outputPath: string
): Promise<string> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vf',
      'scale=360:-2,fps=2',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '32',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { timeout: 30_000 }
  );
  return outputPath;
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

export async function probeVideoDimensions(
  videoPath: string
): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:stream_tags=rotate:side_data=rotation',
        '-of',
        'json',
        videoPath,
      ],
      { timeout: 10_000 }
    );
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{
        width?: number;
        height?: number;
        tags?: { rotate?: string | number };
        side_data_list?: Array<{ rotation?: number | string }>;
      }>;
    };
    const stream = parsed.streams?.[0];
    if (!stream || !stream.width || !stream.height) return null;

    const tagRotate = Number(stream.tags?.rotate ?? 0);
    const sideRotate = Number(stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
    const rotation = Number.isFinite(tagRotate) && tagRotate !== 0 ? tagRotate : Number.isFinite(sideRotate) ? sideRotate : 0;
    const isQuarterTurn = Math.abs(Math.round(rotation)) % 180 === 90;

    return isQuarterTurn
      ? { width: stream.height, height: stream.width }
      : { width: stream.width, height: stream.height };
  } catch {
    return null;
  }
}

/**
 * Lossless / full-resolution YouTube Shorts orientation formatter using FFmpeg.
 * Preserves 100% original pixel resolution and quality via `-c:v copy` with
 * display rotation metadata (`-display_rotation:v:0 270`, 90° clockwise) when
 * compatible, falling back to visually lossless `transpose=1` (`-crf 14`) only
 * if the input container/codec cannot be stream-copied into MP4.
 */
export class FfmpegShortsFormatter implements IVideoFormatter {
  async formatToVerticalShorts(
    inputPath: string,
    outputPath: string,
    _cameraTrack?: CameraKeyframe[]
  ): Promise<void> {
    const dims = await probeVideoDimensions(inputPath);
    const isLandscape = dims ? dims.width > dims.height : true;

    try {
      const copyArgs = isLandscape
        ? [
            '-y',
            '-display_rotation:v:0',
            '270',
            '-i',
            inputPath,
            '-map',
            '0:v:0',
            '-an',
            '-c:v',
            'copy',
            '-movflags',
            '+faststart',
            outputPath,
          ]
        : ['-y', '-i', inputPath, '-map', '0:v:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', outputPath];

      await execFileAsync('ffmpeg', copyArgs, { timeout: 60_000 });
      const outDims = await probeVideoDimensions(outputPath);
      if (outDims && outDims.height > outDims.width) {
        console.log(
          `[GoalCast FFmpeg] Lossless stream copy preserved exact resolution: ${outDims.width}x${outDims.height}`
        );
        return;
      }
    } catch {
      // Non-MP4 input codec (e.g., WebM/VP9) — fall through to visually lossless transcode
    }

    const filterChain = buildLandscapeRotationFilter(isLandscape);
    console.log(
      `[GoalCast FFmpeg] Source dimensions: ${dims ? `${dims.width}x${dims.height}` : 'unknown'} -> lossless-grade full-res (${filterChain})`
    );

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
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '14',
        '-pix_fmt',
        'yuv420p',
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

  async replaceAudioTrack(
    formattedVideoPath: string,
    audioPath: string,
    finalOutputPath: string
  ): Promise<void> {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        formattedVideoPath,
        '-i',
        audioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
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

  async mixOriginalAndCrowdTrack(
    formattedVideoPath: string,
    rawSourcePath: string,
    crowdAudioPath: string,
    finalOutputPath: string
  ): Promise<void> {
    const hasOriginalAudio = await probeHasAudioStream(rawSourcePath);
    if (!hasOriginalAudio) {
      await this.replaceAudioTrack(formattedVideoPath, crowdAudioPath, finalOutputPath);
      return;
    }

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        formattedVideoPath,
        '-i',
        rawSourcePath,
        '-i',
        crowdAudioPath,
        '-filter_complex',
        '[1:a]volume=0.35[orig];[2:a]volume=0.95[crowd];[orig][crowd]amix=inputs=2:duration=shortest:dropout_transition=0:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9[aout]',
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
