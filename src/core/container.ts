import { getEnv } from '../config/env.js';
import type {
  IChannelRepository,
  IQueueRepository,
  IVideoStorageProvider,
} from './interfaces/providers.js';
import { GoalCastPipelineOrchestrator } from './pipeline/orchestrator.js';
import { GeminiGoalAnalyzer } from './providers/ai/gemini-analyzer.js';
import { LocalCrowdAudioProvider } from './providers/audio/crowd-audio.js';
import { LocalPreviewRepository } from './providers/db/local-preview-repository.js';
import { NeonChannelRepository, NeonQueueRepository } from './providers/db/neon-repository.js';
import { YouTubeShortsPublisher } from './providers/publisher/youtube-publisher.js';
import { LocalDiskStorageProvider } from './providers/storage/local-disk-storage.js';
import { VercelBlobStorageProvider } from './providers/storage/vercel-blob-storage.js';
import { FfmpegAudioMixer, FfmpegShortsFormatter } from './providers/video/ffmpeg-media.js';

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
  const crowdAudio = new LocalCrowdAudioProvider({
    elevenLabsApiKey: env.ELEVENLABS_API_KEY,
  });
  const audioMixer = new FfmpegAudioMixer();
  const publisher = new YouTubeShortsPublisher();

  const orchestrator = new GoalCastPipelineOrchestrator({
    queueRepo,
    channelRepo,
    storage,
    formatter,
    analyzer,
    crowdAudio,
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
