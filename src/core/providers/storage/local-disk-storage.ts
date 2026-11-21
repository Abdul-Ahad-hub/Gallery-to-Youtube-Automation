import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  IVideoStorageProvider,
  UploadedBlobResult,
} from '../../interfaces/providers';

export class LocalDiskStorageProvider implements IVideoStorageProvider {
  public readonly providerName = 'local-preview-disk' as const;
  private readonly baseDir: string;

  constructor(baseDir: string = path.resolve(process.cwd(), 'data', 'uploads')) {
    this.baseDir = path.resolve(baseDir);
  }

  private normalizeLocalPathname(blobUrlOrPath: string): string {
    return blobUrlOrPath.replace(/^local:\/\//, '').replace(/^\/+/, '').replace(/\.\./g, '_');
  }

  private resolveSafePath(blobUrlOrPath: string): string {
    const sanitized = this.normalizeLocalPathname(blobUrlOrPath);
    const resolved = path.resolve(this.baseDir, sanitized);
    if (!resolved.startsWith(this.baseDir + path.sep)) {
      throw new Error('Invalid storage path outside permitted upload directory.');
    }
    return resolved;
  }

  async uploadBuffer(
    pathname: string,
    buffer: Buffer,
    _contentType: string
  ): Promise<UploadedBlobResult> {
    const cleanPathname = this.normalizeLocalPathname(pathname);
    const target = this.resolveSafePath(cleanPathname);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    return {
      url: `local://${cleanPathname}`,
      pathname: cleanPathname,
    };
  }

  async downloadToFile(blobUrlOrPath: string, destinationPath: string): Promise<boolean> {
    const source = this.resolveSafePath(blobUrlOrPath);
    try {
      await fs.access(source);
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(source, destinationPath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(blobUrlOrPath: string): Promise<void> {
    const target = this.resolveSafePath(blobUrlOrPath);
    try {
      await fs.unlink(target);
    } catch {
      // Already deleted or seed clip without local binary
    }
  }

  async objectExists(blobUrlOrPath: string): Promise<boolean> {
    const target = this.resolveSafePath(blobUrlOrPath);
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
