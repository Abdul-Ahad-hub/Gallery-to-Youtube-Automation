import { z } from 'zod';

const optionalNonEmpty = z
  .string()
  .optional()
  .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined));

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_URL: optionalNonEmpty.default('http://localhost:3000'),
  DATABASE_URL: optionalNonEmpty,
  BLOB_READ_WRITE_TOKEN: optionalNonEmpty,
  GEMINI_API_KEY: optionalNonEmpty,
  YOUTUBE_CLIENT_ID: optionalNonEmpty,
  YOUTUBE_CLIENT_SECRET: optionalNonEmpty,
  YOUTUBE_REDIRECT_URI: optionalNonEmpty,
  YOUTUBE_PRIVACY_STATUS: z.enum(['public', 'unlisted', 'private']).default('public'),
  ELEVENLABS_API_KEY: optionalNonEmpty,
  ELEVENLABS_VOICE_ID: optionalNonEmpty.default('pNInz6obpgDQGcFmaJgB'),
  EDGE_TTS_VOICE: optionalNonEmpty.default('en-GB-RyanNeural'),
  REQUIRE_UPLOAD_APPROVAL: optionalNonEmpty.default('false'),
  AUTH_SESSION_SECRET: optionalNonEmpty,
  AUTH_PROD_USER: optionalNonEmpty,
  AUTH_PROD_PASS: optionalNonEmpty,
  AUTH_ADMIN_USER: optionalNonEmpty,
  AUTH_ADMIN_PASS: optionalNonEmpty,
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}

export function isVercelBlobConfigured(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(getEnv(source).BLOB_READ_WRITE_TOKEN);
}

export function isUploadApprovalRequired(source: NodeJS.ProcessEnv = process.env): boolean {
  return getEnv(source).REQUIRE_UPLOAD_APPROVAL === 'true';
}
