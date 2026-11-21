import { getEnv } from '../config/env';
import type {
  IChannelRepository,
  IQueueRepository,
  IVideoStorageProvider,
} from './interfaces/providers';
import { GoalCastPipelineOrchestrator } from './pipeline/orchestrator';
import { GeminiGoalAnalyzer } from './providers/ai/gemini-analyzer';
import { LocalPreviewRepository } from './providers/db/local-preview-repository';
import { NeonChannelRepository, NeonQueueRepository } from './providers/db/neon-repository';
import { YouTubeShortsPublisher } from './providers/publisher/youtube-publisher';
import { LocalDiskStorageProvider } from './providers/storage/local-disk-storage';
import { VercelBlobStorageProvider } from './providers/storage/vercel-blob-storage';
import { FfmpegAudioMixer, FfmpegShortsFormatter } from './providers/video/ffmpeg-media';
import { HybridCommentaryVoiceSynthesizer } from './providers/voice/commentary-voice';

export interface AppContainer {
  queueRepo: IQueueRepository;
  channelRepo: IChannelRepository;
  storage: IVideoStorageProvider;
  orchestrator: GoalCastPipelineOrchestrator;
}

let cachedContainer: AppContainer | null = null;

function createStorageProvider(): IVideoStorageProvider {
  const env = getEnv();
  if (env.BLOB_READ_WRITE_TOKEN) {
    return new VercelBlobStorageProvider(env.BLOB_READ_WRITE_TOKEN);
  }
  return new LocalDiskStorageProvider();
}

export function getAppContainer(): AppContainer {
  if (cachedContainer) return cachedContainer;

  const env = getEnv();
  let queueRepo: IQueueRepository;
  let channelRepo: IChannelRepository;

  if (env.DATABASE_URL) {
    queueRepo = new NeonQueueRepository(env.DATABASE_URL);
    channelRepo = new NeonChannelRepository(env.DATABASE_URL);
  } else {
    const localRepo = new LocalPreviewRepository();
    queueRepo = localRepo;
    channelRepo = localRepo;
  }

  const storage = createStorageProvider();
  const formatter = new FfmpegShortsFormatter();
  const analyzer = new GeminiGoalAnalyzer(env.GEMINI_API_KEY);
  const voiceSynthesizer = new HybridCommentaryVoiceSynthesizer({
    elevenLabsKey: env.ELEVENLABS_API_KEY,
    elevenLabsVoiceId: env.ELEVENLABS_VOICE_ID,
    edgeVoiceName: env.EDGE_TTS_VOICE,
  });
  const audioMixer = new FfmpegAudioMixer();
  const publisher = new YouTubeShortsPublisher();

  const orchestrator = new GoalCastPipelineOrchestrator({
    queueRepo,
    channelRepo,
    storage,
    formatter,
    analyzer,
    voiceSynthesizer,
    audioMixer,
    publisher,
  });

  cachedContainer = {
    queueRepo,
    channelRepo,
    storage,
    orchestrator,
  };

  return cachedContainer;
}
