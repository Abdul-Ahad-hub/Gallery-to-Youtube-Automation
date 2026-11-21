import fs from 'node:fs/promises';
import { GoogleGenAI, Type } from '@google/genai';
import { normalizeGoalAnalysis } from '../../domain/commentary-sync';
import type { GoalAnalysisResult } from '../../domain/types';
import type { IVideoAnalyzer } from '../../interfaces/providers';

const GEMINI_MODEL = 'gemini-4-hydrogen';
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
      `You are an iconic, passionate live television football (soccer) commentator and YouTube Shorts producer.`,
      `Analyze this ${duration.toFixed(1)}-second football goal clip (filename hint: "${input.originalFilename}").`,
      `Identify four tightly synchronized visual moments across 0.0s to ${duration.toFixed(1)}s:`,
      `1. "buildup": the run, pass, or space opening before the shot`,
      `2. "strike": the exact split-second the player strikes the ball`,
      `3. "net_impact": the exact moment the ball hits the back of the net`,
      `4. "celebration": the crowd eruption or player celebration`,
      `Write vivid, high-energy broadcast commentary lines strictly paced to fit each timestamp window (~3 words per second max) so voiceover audio syncs effortlessly to the goal without trailing past ${duration.toFixed(1)}s.`,
      `Also generate a punchy YouTube Shorts title (including #Shorts, under 90 characters), an engaging 1-2 sentence description, and 4 relevant football tags.`,
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

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        systemInstruction:
          'You are a world-class live football commentator. Return crisp, authentic, strictly timed broadcast commentary cues in valid JSON matching the schema.',
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
                    description: 'Passionate spoken commentary line sized for the cue duration.',
                  },
                  energy: {
                    type: Type.STRING,
                    description: 'One of: rising, peak, explosive, afterglow',
                  },
                },
                required: ['beat', 'startSec', 'endSec', 'text', 'energy'],
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
          ],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      throw new Error('Gemini returned an empty commentary response.');
    }

    const parsed = JSON.parse(rawText) as Omit<GoalAnalysisResult, 'fullScript'>;
    return normalizeGoalAnalysis(parsed, duration);
  }
}
