import fs from 'node:fs/promises';
import { GoogleGenAI, Type } from '@google/genai';
import { normalizeGoalAnalysis } from '../../domain/commentary-sync.js';
import type { GoalAnalysisResult } from '../../domain/types.js';
import type { IVideoAnalyzer } from '../../interfaces/providers.js';

const GEMINI_MODELS = ['gemini-4-hydrogen', 'gemini-3.6-flash', 'gemini-3.5-flash'] as const;
const MAX_INLINE_VIDEO_BYTES = 18 * 1024 * 1024;

export class GeminiGoalAnalyzer implements IVideoAnalyzer {
  private readonly apiKey: string | undefined;

  constructor(apiKey: string | undefined = process.env.GEMINI_API_KEY) {
    this.apiKey = apiKey?.trim() || undefined;
  }

  private getClient(): GoogleGenAI {
    if (!this.apiKey) {
      throw new Error(
        'GEMINI_API_KEY is not configured on the server. Add your Google AI Studio Gemini API key to enable video understanding and commentary scriptwriting.'
      );
    }
    return new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  async analyzeGoalClip(input: {
    videoPath: string | null;
    mimeType: string;
    originalFilename: string;
    durationSec: number;
  }): Promise<GoalAnalysisResult> {
    const ai = this.getClient();
    const duration = Math.max(3.0, Math.min(12.0, input.durationSec || 6.0));

    const promptText = [
      `You are an electrifying, high-voltage live stadium football (soccer) commentator (think Peter Drury / Martin Tyler / Ray Hudson at a Champions League final) AND a vertical 9:16 sports camera director.`,
      `Analyze this ${duration.toFixed(1)}-second football goal clip (filename hint: "${input.originalFilename}").`,
      ``,
      `PART 1 — EXPLOSIVE SYNCED COMMENTARY:`,
      `Identify four tightly synchronized visual moments across 0.0s to ${duration.toFixed(1)}s:`,
      `1. "buildup": the run, pass, or space opening before the shot (hook the viewer immediately with urgency!)`,
      `2. "strike": the exact split-second the player strikes the ball (rising crescendo!)`,
      `3. "net_impact": the exact moment the ball hits the back of the net (EXPLOSIVE peak — e.g. "GOOOAL!!", "WHAT A ROCKET!!", "BURIED IN THE TOP CORNER!!")`,
      `4. "celebration": the crowd eruption or player celebration (goosebump-inducing punchline!)`,
      `Write DRAMATIC, PASSIONATE, HIGH-ENERGY broadcast commentary that keeps viewers hooked from the very first syllable. Avoid flat, robotic, or generic narration. Use punchy exclamations, vivid action verbs, and rhythm strictly paced to fit each timestamp window (~3 words per second max) so the voiceover stays in tight sync and finishes by ${duration.toFixed(1)}s.`,
      `Also generate a punchy YouTube Shorts title (including #Shorts, under 90 characters), an engaging 1-2 sentence description, and 4 relevant football tags.`,
      ``,
      `PART 2 — DYNAMIC 9:16 CAMERA TRACKING (cameraTrack):`,
      `Return a "cameraTrack" array of 4 to 6 keyframes ({ "timeSec": number, "centerX": number }) where "centerX" is the normalized horizontal focal point from 0.0 (far left) to 1.0 (far right) used to pan a zoomed-in 9:16 portrait window across the wide pitch.`,
      `- Track the ball and active play smoothly across the entire ${duration.toFixed(1)}s clip.`,
      `- Anticipate the finish: as the shot is taken, smoothly lead "centerX" toward the goal and goalkeeper so BOTH the strike and the ball hitting the net stay cleanly inside the vertical frame.`,
      `- Reference calibration (from a Football League 26 21:9 replay clip attacking right-to-left):`,
      `  * 0.0s – 2.5s (buildup on right/midfield): centerX moves from ~0.75 to ~0.55`,
      `  * 3.0s – 4.0s (key pass at edge of box): centerX around ~0.45`,
      `  * 4.0s – 4.7s (shot): centerX shifts left to ~0.30`,
      `  * 4.7s – 5.9s (ball hits net on left): centerX settles around ~0.20`,
      `- Adapt the direction to the actual clip (e.g., if attacking left-to-right, mirror accordingly). Always keep centerX safely within [0.0, 1.0] and strictly ascending by timeSec.`,
    ].join('\n');

    const parts: Array<
      { inlineData: { mimeType: string; data: string } } | { text: string }
    > = [];

    if (input.videoPath) {
      const stat = await fs.stat(input.videoPath).catch(() => null);
      if (stat && stat.size > 0 && stat.size <= MAX_INLINE_VIDEO_BYTES) {
        const buffer = await fs.readFile(input.videoPath);
        parts.push({
          inlineData: {
            mimeType: input.mimeType || 'video/mp4',
            data: buffer.toString('base64'),
          },
        });
      }
    }

    parts.push({ text: promptText });

    const requestConfig = {
      systemInstruction:
        'You are an electrifying live football commentator and 9:16 sports camera director. Return high-energy, strictly timed broadcast commentary cues and smooth ball-tracking cameraTrack keyframes in valid JSON matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: 'One-sentence visual summary of the football goal play.',
          },
          strikeTimestampSec: {
            type: Type.NUMBER,
            description: 'Exact timestamp in seconds when the player strikes the ball.',
          },
          netImpactTimestampSec: {
            type: Type.NUMBER,
            description: 'Exact timestamp in seconds when the ball hits the net.',
          },
          shortsTitle: {
            type: Type.STRING,
            description: 'Catchy YouTube Shorts title including #Shorts.',
          },
          shortsDescription: {
            type: Type.STRING,
            description: 'Short engaging description for YouTube Shorts.',
          },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Relevant football hashtags without leading #.',
          },
          cues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                beat: {
                  type: Type.STRING,
                  description: 'One of: buildup, strike, net_impact, celebration',
                },
                startSec: { type: Type.NUMBER },
                endSec: { type: Type.NUMBER },
                text: {
                  type: Type.STRING,
                  description: 'Electrifying, passionate spoken commentary line sized for the cue duration.',
                },
                energy: {
                  type: Type.STRING,
                  description: 'One of: rising, peak, explosive, afterglow',
                },
              },
              required: ['beat', 'startSec', 'endSec', 'text', 'energy'],
            },
          },
          cameraTrack: {
            type: Type.ARRAY,
            description: '4 to 6 chronological camera tracking keyframes for 9:16 pan-and-scan crop.',
            items: {
              type: Type.OBJECT,
              properties: {
                timeSec: {
                  type: Type.NUMBER,
                  description: 'Timestamp in seconds (0.0 to clip duration).',
                },
                centerX: {
                  type: Type.NUMBER,
                  description: 'Normalized horizontal focus from 0.0 (far left) to 1.0 (far right).',
                },
              },
              required: ['timeSec', 'centerX'],
            },
          },
        },
        required: [
          'summary',
          'strikeTimestampSec',
          'netImpactTimestampSec',
          'shortsTitle',
          'shortsDescription',
          'tags',
          'cues',
          'cameraTrack',
        ],
      },
    };

    let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
    let lastError: unknown = null;

    for (const model of GEMINI_MODELS) {
      try {
        console.log(`[GoalCast Gemini] Analyzing clip with model "${model}"...`);
        response = await ai.models.generateContent({
          model,
          contents: { parts },
          config: requestConfig,
        });
        break;
      } catch (err) {
        lastError = err;
        console.warn(
          `[GoalCast Gemini] Model "${model}" failed, trying fallback:`,
          err instanceof Error ? err.message.slice(0, 160) : String(err)
        );
      }
    }

    if (!response) {
      throw lastError instanceof Error
        ? lastError
        : new Error('All Gemini models failed to analyze the clip.');
    }

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      throw new Error('Gemini returned an empty commentary response.');
    }

    const parsed = JSON.parse(rawText) as Omit<GoalAnalysisResult, 'fullScript'>;
    return normalizeGoalAnalysis(parsed, duration);
  }
}
