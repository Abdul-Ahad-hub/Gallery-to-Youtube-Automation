import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildBroadcastMixFilterGraph } from '../../domain/commentary-sync.js';
import type {
  ComposeCrowdOptionInput,
  CrowdAudioMixResult,
  ICrowdAudioProvider,
} from '../../interfaces/providers.js';
import { ElevenLabsVoiceProvider } from '../voice/commentary-voice.js';

const execFileAsync = promisify(execFile);
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']);

function pickRandomItem<T>(files: T[]): T {
  const idx = Math.floor(Math.random() * files.length);
  return files[idx];
}

async function listAudioFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter(
      (entry) =>
        entry.isFile() && SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    )
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

/**
 * 3-layer football broadcast audio composer:
 * 1. Normal crowd ambience (0.0s -> rise -> swells into burst roar at goal, +0.3s default delay)
 * 2. Initial buildup commentary via ElevenLabs TTS (0.15s -> ~3.5s), then dramatic pause
 *    — automatically falls back to Crowd Only if ElevenLabs fails or is unconfigured
 * 3. Optional hardcoded iconic goal shout ("What a strike!!" or "GOOOAL!!") right on goal impact
 */
export class LocalCrowdAudioProvider implements ICrowdAudioProvider {
  private readonly normalDir: string;
  private readonly burstDir: string;
  private readonly shoutDir: string;
  private readonly elevenLabsApiKey: string | undefined;
  private readonly elevenLabsVoiceId: string;
  private readonly introVoiceCache = new Map<string, Buffer>();

  constructor(options?: {
    normalDir?: string;
    burstDir?: string;
    shoutDir?: string;
    elevenLabsApiKey?: string;
    elevenLabsVoiceId?: string;
  }) {
    this.normalDir =
      options?.normalDir ?? path.resolve(process.cwd(), 'src', 'assets', 'audio', 'normal');
    this.burstDir =
      options?.burstDir ?? path.resolve(process.cwd(), 'src', 'assets', 'audio', 'burst');
    this.shoutDir =
      options?.shoutDir ?? path.resolve(process.cwd(), 'src', 'assets', 'audio', 'goal-shouts');
    this.elevenLabsApiKey =
      (options?.elevenLabsApiKey ?? process.env.ELEVENLABS_API_KEY)?.trim() || undefined;
    this.elevenLabsVoiceId =
      options?.elevenLabsVoiceId?.trim() ||
      process.env.ELEVENLABS_VOICE_ID?.trim() ||
      'pNInz6obpgDQGcFmaJgB';
  }

  async composeCrowdTrack(
    durationSec: number,
    outputAudioPath: string,
    burstStartSec?: number
  ): Promise<CrowdAudioMixResult> {
    return this.composeOption({
      mode: 'broadcast-shout-1',
      durationSec,
      outputAudioPath,
      eruptSec: burstStartSec,
      delayOffsetSec: 0.3,
    });
  }

  async composeOption(input: ComposeCrowdOptionInput): Promise<CrowdAudioMixResult> {
    const [normalFiles, burstFiles, shoutFiles] = await Promise.all([
      listAudioFiles(this.normalDir),
      listAudioFiles(this.burstDir),
      listAudioFiles(this.shoutDir),
    ]);

    if (normalFiles.length === 0) {
      throw new Error(`No normal stadium crowd audio files found in ${this.normalDir}`);
    }
    if (burstFiles.length === 0) {
      throw new Error(`No crowd burst audio files found in ${this.burstDir}`);
    }

    const safeDuration = Math.max(2.0, Number(input.durationSec.toFixed(2)) || 6.0);
    const baseErupt =
      input.eruptSec ??
      (safeDuration >= 5.5 ? 4.85 : Math.max(1.2, Number((safeDuration * 0.82).toFixed(2))));
    const delayOffset = input.delayOffsetSec ?? 0.3;
    const effectiveBurstStart = Math.max(
      1.2,
      Math.min(safeDuration - 0.3, Number((baseErupt + delayOffset).toFixed(2)))
    );
    const effectiveRiseStart = Math.max(
      0.4,
      Math.min(
        effectiveBurstStart - 0.25,
        Number((input.riseStartSec ?? safeDuration * 0.58).toFixed(2))
      )
    );

    const normalFile = pickRandomItem(normalFiles);
    const burstFile = pickRandomItem(burstFiles);
    const normalName = path.basename(normalFile);
    const burstName = path.basename(burstFile);

    let effectiveMode = input.mode;
    const wantsIntro = effectiveMode !== 'pure-crowd';
    const introTempPath = `${input.outputAudioPath}.intro.mp3`;
    let hasIntroVoice = false;
    let elevenLabsFailed = false;

    try {
      if (wantsIntro) {
        const line =
          input.buildupLine?.trim() || 'He drives into the box, opening up space for the strike...';
        const cached = this.introVoiceCache.get(line);
        if (cached) {
          await fs.writeFile(introTempPath, cached);
          hasIntroVoice = true;
        } else if (this.elevenLabsApiKey) {
          try {
            const elevenLabs = new ElevenLabsVoiceProvider(
              this.elevenLabsApiKey,
              this.elevenLabsVoiceId
            );
            const synth = await elevenLabs.synthesize(
              [{ beat: 'buildup', startSec: 0, endSec: 3.3, text: line, energy: 'rising' }],
              introTempPath
            );
            if (synth.audioPath) {
              hasIntroVoice = true;
              const buf = await fs.readFile(introTempPath).catch(() => null);
              if (buf && buf.length > 0) this.introVoiceCache.set(line, buf);
            }
          } catch (elErr) {
            elevenLabsFailed = true;
            effectiveMode = 'pure-crowd';
            console.warn(
              '[GoalCast Audio] ElevenLabs unavailable, falling back to pure-crowd:',
              elErr instanceof Error ? elErr.message : String(elErr)
            );
          }
        } else {
          elevenLabsFailed = true;
          effectiveMode = 'pure-crowd';
          console.warn('[GoalCast Audio] ELEVENLABS_API_KEY missing, falling back to pure-crowd.');
        }
      }

      const wantsShout =
        effectiveMode !== 'pure-crowd' &&
        (effectiveMode === 'broadcast-shout-1' || effectiveMode === 'broadcast-shout-2') &&
        shoutFiles.length > 0;

      let shoutFile: string | null = null;
      let shoutStartSec = Math.max(4.3, effectiveBurstStart - 0.15);
      let shoutTempo = 1.0;

      if (wantsShout) {
        if (effectiveMode === 'broadcast-shout-1') {
          shoutFile = shoutFiles.find((f) => f.includes('goal-shout-1')) ?? shoutFiles[0];
          shoutStartSec = Math.max(4.4, effectiveBurstStart - 0.12);
          shoutTempo = 1.05;
        } else {
          shoutFile =
            shoutFiles.find((f) => f.includes('goal-shout-2')) ?? shoutFiles[1] ?? shoutFiles[0];
          shoutStartSec = Math.max(4.4, effectiveBurstStart - 0.15);
          shoutTempo = 1.2;
        }
      }

      const filterComplex = buildBroadcastMixFilterGraph({
        hasIntroVoice,
        hasGoalShout: Boolean(shoutFile),
        totalDurationSec: safeDuration,
        riseStartSec: effectiveRiseStart,
        burstStartSec: effectiveBurstStart,
        shoutStartSec,
        shoutTempo,
      });

      const ffmpegInputs = ['-y', '-i', normalFile, '-i', burstFile];
      if (hasIntroVoice) ffmpegInputs.push('-i', introTempPath);
      if (shoutFile) ffmpegInputs.push('-i', shoutFile);

      console.log(
        `[GoalCast Audio] (${effectiveMode}) crowd=${normalName}+${burstName}, intro=${hasIntroVoice ? 'yes' : 'no'}, shout=${shoutFile ? path.basename(shoutFile) : 'none'} (burst=${effectiveBurstStart}s, shoutAt=${shoutFile ? shoutStartSec.toFixed(2) + 's' : 'n/a'})`
      );

      const isMp3 = path.extname(input.outputAudioPath).toLowerCase() === '.mp3';
      const codecArgs = isMp3 ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ['-c:a', 'aac', '-b:a', '192k'];

      await execFileAsync(
        'ffmpeg',
        [...ffmpegInputs, '-filter_complex', filterComplex, '-map', '[aout]', ...codecArgs, input.outputAudioPath],
        { timeout: 60_000 }
      );
    } finally {
      await fs.unlink(introTempPath).catch(() => {});
    }

    const modeLabels: Record<ComposeCrowdOptionInput['mode'], string> = {
      'broadcast-shout-1': 'Commentary + "What a strike!"',
      'broadcast-shout-2': 'Commentary + "GOOOAL!!"',
      'broadcast-crowd-only': 'Commentary + Crowd Roar',
      'pure-crowd': elevenLabsFailed ? 'Crowd Only (ElevenLabs fallback)' : 'Crowd Only',
    };

    return {
      audioPath: input.outputAudioPath,
      mode: effectiveMode,
      normalTrackName: normalName,
      burstTrackName: burstName,
      label: modeLabels[effectiveMode],
    };
  }
}
