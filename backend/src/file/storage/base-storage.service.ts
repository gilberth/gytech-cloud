import { Logger } from '@nestjs/common';
import {
  CloudStorageProvider,
  CloudStorageCapabilities,
  UploadParams,
  UploadResult,
  DownloadOptions,
  FileMetadata,
  PresignedUrlOptions,
  MultipartUploadInit,
  MultipartUploadPart,
  HealthCheckResult,
} from './cloud-storage.interface';

export abstract class BaseStorageService implements CloudStorageProvider {
  protected readonly logger = new Logger(this.constructor.name);
  
  abstract readonly name: string;
  abstract readonly capabilities: CloudStorageCapabilities;

  abstract upload(params: UploadParams): Promise<UploadResult>;
  
  abstract download(
    path: string,
    options?: DownloadOptions,
  ): Promise<NodeJS.ReadableStream>;
  
  abstract delete(path: string): Promise<void>;
  
  abstract getMetadata(path: string): Promise<FileMetadata>;
  
  abstract healthCheck(): Promise<HealthCheckResult>;

  getUrl?(
    path: string,
    options?: PresignedUrlOptions,
  ): Promise<string> {
    throw new Error(`Provider ${this.name} does not support presigned URLs`);
  }

  multipartInit?(
    path: string,
    size?: number,
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<MultipartUploadInit> {
    throw new Error(`Provider ${this.name} does not support multipart uploads`);
  }

  multipartUploadPart?(
    uploadId: string,
    partNumber: number,
    data: Buffer | NodeJS.ReadableStream,
    size?: number,
  ): Promise<{ etag: string }> {
    throw new Error(`Provider ${this.name} does not support multipart uploads`);
  }

  multipartComplete?(
    uploadId: string,
    path: string,
    parts: MultipartUploadPart[],
  ): Promise<UploadResult> {
    throw new Error(`Provider ${this.name} does not support multipart uploads`);
  }

  multipartAbort?(uploadId: string, path: string): Promise<void> {
    throw new Error(`Provider ${this.name} does not support multipart uploads`);
  }

  listFiles?(
    prefix?: string,
    limit?: number,
    continuationToken?: string,
  ): Promise<{
    files: Array<{
      path: string;
      size: number;
      lastModified: Date;
      etag?: string;
    }>;
    continuationToken?: string;
  }> {
    throw new Error(`Provider ${this.name} does not support file listing`);
  }

  protected buildPath(relativePath: string): string {
    return relativePath.replace(/^\/+/, '');
  }

  protected async measureLatency<T>(
    operation: () => Promise<T>,
  ): Promise<{ result: T; latencyMs: number }> {
    const start = Date.now();
    try {
      const result = await operation();
      const latencyMs = Date.now() - start;
      return { result, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - start;
      this.logger.error(`Operation failed after ${latencyMs}ms: ${error.message}`);
      throw error;
    }
  }

  protected handleStorageError(error: any, operation: string): never {
    this.logger.error(`${this.name} ${operation} failed:`, error);
    
    if (error.code === 'ENOENT' || error.status === 404) {
      throw new Error(`File not found in ${this.name}`);
    }
    
    if (error.code === 'ENOSPC' || error.status === 507) {
      throw new Error(`Insufficient storage space in ${this.name}`);
    }
    
    if (error.code === 'ETIMEDOUT' || error.status === 408) {
      throw new Error(`Operation timeout in ${this.name}`);
    }
    
    if (error.status === 401 || error.status === 403) {
      throw new Error(`Authentication failed for ${this.name}`);
    }
    
    if (error.status >= 500) {
      throw new Error(`${this.name} server error: ${error.message}`);
    }
    
    throw new Error(`${this.name} error: ${error.message || 'Unknown error'}`);
  }
}