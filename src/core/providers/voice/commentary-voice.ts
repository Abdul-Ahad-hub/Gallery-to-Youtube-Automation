import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import type { CommentaryCue } from '../../domain/types';
import type { IVoiceSynthesizer, VoiceSynthesisResult } from '../../interfaces/providers';

const execFileAsync = promisify(execFile);

function joinCuesForSpeech(cues: CommentaryCue[]): string {
  return cues.map((cue) => cue.text.trim()).filter(Boolean).join(' ');
}

/**
 * Primary Voice Provider: ElevenLabs API (Free tier).
 * Tuned for high-energy, expressive football broadcast commentary.
 */
export class ElevenLabsVoiceProvider implements IVoiceSynthesizer {
  private readonly apiKey: string;
  private readonly voiceId: string;

  constructor(apiKey: string, voiceId: string = 'pNInz6obpgDQGcFmaJgB') {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
  }

  async synthesize(
    cues: CommentaryCue[],
    outputAudioPath: string
  ): Promise<VoiceSynthesisResult> {
    const scriptText = joinCuesForSpeech(cues);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: scriptText,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.32,
            similarity_boost: 0.82,
            style: 0.78,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`ElevenLabs synthesis failed (HTTP ${response.status}): ${errorBody.slice(0, 200)}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputAudioPath, audioBuffer);
    return { audioPath: outputAudioPath, providerUsed: 'elevenlabs' };
  }
}

/**
 * Automatic Free Unlimited Fallback: Microsoft Edge TTS CLI (`edge-tts`).
 * Installed automatically in GitHub Actions workflow (`pip install edge-tts`).
 */
export class EdgeTtsVoiceProvider implements IVoiceSynthesizer {
  private readonly voiceName: string;

  constructor(voiceName: string = process.env.EDGE_TTS_VOICE || 'en-GB-RyanNeural') {
    this.voiceName = voiceName;
  }

  async synthesize(
    cues: CommentaryCue[],
    outputAudioPath: string
  ): Promise<VoiceSynthesisResult> {
    const scriptText = joinCuesForSpeech(cues);
    await execFileAsync(
      'edge-tts',
      [
        '--voice',
        this.voiceName,
        '--rate=+14%',
        '--pitch=+6Hz',
        '--text',
        scriptText,
        '--write-media',
        outputAudioPath,
      ],
      { timeout: 60_000 }
    );
    return { audioPath: outputAudioPath, providerUsed: 'edge-tts' };
  }
}

/**
 * Composite Voice Provider: Uses ElevenLabs when ELEVENLABS_API_KEY is configured,
 * and seamlessly falls back to free unlimited Edge TTS if unset or rate-limited.
 */
export class HybridCommentaryVoiceSynthesizer implements IVoiceSynthesizer {
  private readonly elevenLabsKey: string | undefined;
  private readonly elevenLabsVoiceId: string;
  private readonly edgeVoiceName: string;

  constructor(options?: {
    elevenLabsKey?: string;
    elevenLabsVoiceId?: string;
    edgeVoiceName?: string;
  }) {
    this.elevenLabsKey = (options?.elevenLabsKey ?? process.env.ELEVENLABS_API_KEY)?.trim() || undefined;
    this.elevenLabsVoiceId =
      options?.elevenLabsVoiceId ?? process.env.ELEVENLABS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB';
    this.edgeVoiceName = options?.edgeVoiceName ?? process.env.EDGE_TTS_VOICE ?? 'en-GB-RyanNeural';
  }

  async synthesize(
    cues: CommentaryCue[],
    outputAudioPath: string
  ): Promise<VoiceSynthesisResult> {
    if (this.elevenLabsKey) {
      try {
        const primary = new ElevenLabsVoiceProvider(this.elevenLabsKey, this.elevenLabsVoiceId);
        return await primary.synthesize(cues, outputAudioPath);
      } catch (primaryErr) {
        console.warn(
          '[GoalCast Voice] ElevenLabs failed, falling back automatically to free Edge TTS:',
          primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
        );
      }
    }

    try {
      const fallback = new EdgeTtsVoiceProvider(this.edgeVoiceName);
      return await fallback.synthesize(cues, outputAudioPath);
    } catch {
      // In environments without edge-tts CLI installed (e.g. lightweight preview container),
      // return script-only metadata while preserving full worker compatibility in GitHub Actions.
      return { audioPath: null, providerUsed: 'script-only' };
    }
  }
}
