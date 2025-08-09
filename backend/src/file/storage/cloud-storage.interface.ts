export interface CloudStorageCapabilities {
  streaming?: boolean;
  multipart?: boolean;
  presignedUrls?: boolean;
  nativeMetadata?: boolean;
  serverSideEncryption?: boolean;
  versioning?: boolean;
}

export interface UploadParams {
  stream: NodeJS.ReadableStream;
  path: string;
  size?: number;
  contentType?: string;
  checksum?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  storedPath: string;
  etag?: string;
  url?: string;
}

export interface DownloadOptions {
  range?: {
    start: number;
    end?: number;
  };
}

export interface FileMetadata {
  size: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface PresignedUrlOptions {
  expiresInSeconds?: number;
  inline?: boolean;
  responseContentType?: string;
  responseContentDisposition?: string;
}

export interface MultipartUploadInit {
  uploadId: string;
  metadata?: Record<string, any>;
}

export interface MultipartUploadPart {
  partNumber: number;
  etag: string;
}

export interface HealthCheckResult {
  ok: boolean;
  details?: Record<string, unknown>;
  latencyMs?: number;
  errorMessage?: string;
}

export interface CloudStorageProvider {
  readonly name: string;
  readonly capabilities: CloudStorageCapabilities;

  upload(params: UploadParams): Promise<UploadResult>;

  download(
    path: string,
    options?: DownloadOptions,
  ): Promise<NodeJS.ReadableStream>;

  delete(path: string): Promise<void>;

  getUrl?(
    path: string,
    options?: PresignedUrlOptions,
  ): Promise<string>;

  getMetadata(path: string): Promise<FileMetadata>;

  multipartInit?(
    path: string,
    size?: number,
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<MultipartUploadInit>;

  multipartUploadPart?(
    uploadId: string,
    partNumber: number,
    data: Buffer | NodeJS.ReadableStream,
    size?: number,
  ): Promise<{ etag: string }>;

  multipartComplete?(
    uploadId: string,
    path: string,
    parts: MultipartUploadPart[],
  ): Promise<UploadResult>;

  multipartAbort?(uploadId: string, path: string): Promise<void>;

  healthCheck(): Promise<HealthCheckResult>;

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
  }>;
}