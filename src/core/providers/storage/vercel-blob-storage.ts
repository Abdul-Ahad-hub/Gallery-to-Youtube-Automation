import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { del, head, put } from '@vercel/blob';
import type {
  IVideoStorageProvider,
  UploadedBlobResult,
} from '../../interfaces/providers.js';

/**
 * Validates that a Blob download URL belongs strictly to an HTTPS Vercel Blob host
 * to prevent SSRF if a database record were ever tampered with.
 */
export function isAllowedVercelBlobUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.endsWith('.blob.vercel-storage.com')
    );
  } catch {
    return false;
  }
}

export class VercelBlobStorageProvider implements IVideoStorageProvider {
  public readonly providerName = 'vercel-blob' as const;
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async uploadBuffer(
    pathname: string,
    buffer: Buffer,
    contentType: string
  ): Promise<UploadedBlobResult> {
    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType,
      token: this.token,
      addRandomSuffix: true,
    });
    return {
      url: blob.url,
      pathname: blob.pathname,
    };
  }

  async downloadToFile(blobUrl: string, destinationPath: string): Promise<boolean> {
    if (!isAllowedVercelBlobUrl(blobUrl)) {
      return false;
    }

    const response = await fetch(blobUrl);
    if (!response.ok || !response.body) {
      return false;
    }

    const writeStream = fs.createWriteStream(destinationPath);
    // Convert Web ReadableStream to Node Readable for streaming write
    const nodeStream = Readable.fromWeb(response.body as never);
    await pipeline(nodeStream, writeStream);
    return true;
  }

  async deleteObject(blobUrl: string): Promise<void> {
    if (!isAllowedVercelBlobUrl(blobUrl)) {
      return;
    }
    await del(blobUrl, { token: this.token });
  }

  async objectExists(blobUrl: string): Promise<boolean> {
    if (!isAllowedVercelBlobUrl(blobUrl)) {
      return false;
    }
    try {
      await head(blobUrl, { token: this.token });
      return true;
    } catch {
      return false;
    }
  }
}
