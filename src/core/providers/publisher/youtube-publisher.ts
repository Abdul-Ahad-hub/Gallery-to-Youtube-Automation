import fs from 'node:fs';
import { google } from 'googleapis';
import type { StoredYouTubeTokens } from '../../domain/types';
import type {
  IShortsPublisher,
  PublishShortInput,
  PublishShortResult,
} from '../../interfaces/providers';

export const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export function resolveYouTubeRedirectUri(): string {
  if (process.env.YOUTUBE_REDIRECT_URI?.trim()) {
    return process.env.YOUTUBE_REDIRECT_URI.trim();
  }
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${appUrl}/auth/youtube/callback`;
}

export function isYouTubeOAuthConfigured(): boolean {
  return Boolean(
    process.env.YOUTUBE_CLIENT_ID?.trim() && process.env.YOUTUBE_CLIENT_SECRET?.trim()
  );
}

export function createYouTubeOAuthClient(redirectUri: string = resolveYouTubeRedirectUri()) {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'YouTube OAuth credentials (YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET) are not configured on the server.'
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function exchangeYouTubeAuthCode(
  code: string,
  redirectUri: string = resolveYouTubeRedirectUri()
): Promise<StoredYouTubeTokens> {
  const oauth2Client = createYouTubeOAuthClient(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const channelResp = await youtube.channels.list({
    part: ['snippet'],
    mine: true,
  });

  const channel = channelResp.data.items?.[0];
  if (!channel?.id) {
    throw new Error('No YouTube channel found on the authorized Google account.');
  }

  return {
    channelId: channel.id,
    channelTitle: channel.snippet?.title ?? 'Connected YouTube Channel',
    channelHandle: channel.snippet?.customUrl ?? null,
    channelThumbnailUrl: channel.snippet?.thumbnails?.default?.url ?? null,
    accessToken: tokens.access_token ?? '',
    refreshToken: tokens.refresh_token ?? '',
    expiryDate: tokens.expiry_date ?? null,
    connectedAt: new Date().toISOString(),
  };
}

/**
 * Real YouTube Data API v3 Shorts Publisher.
 */
export class YouTubeShortsPublisher implements IShortsPublisher {
  async publishShort(input: PublishShortInput): Promise<PublishShortResult> {
    if (!input.videoPath) {
      throw new Error(
        'Cannot publish to YouTube because the rendered video file is unavailable for this clip.'
      );
    }

    const oauth2Client = createYouTubeOAuthClient();
    oauth2Client.setCredentials({
      access_token: input.tokens.accessToken,
      refresh_token: input.tokens.refreshToken,
      expiry_date: input.tokens.expiryDate ?? undefined,
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const privacyStatus =
      process.env.YOUTUBE_PRIVACY_STATUS === 'unlisted' ||
      process.env.YOUTUBE_PRIVACY_STATUS === 'private'
        ? process.env.YOUTUBE_PRIVACY_STATUS
        : 'public';

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: input.title,
          description: input.description,
          tags: input.tags,
          categoryId: '17', // Sports
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(input.videoPath),
      },
    });

    const videoId = response.data.id;
    if (!videoId) {
      throw new Error('YouTube Data API did not return a video ID after upload.');
    }

    return {
      youtubeVideoId: videoId,
      youtubeUrl: `https://www.youtube.com/shorts/${videoId}`,
    };
  }
}
