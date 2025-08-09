import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  BlobServiceClient, 
  StorageSharedKeyCredential,
  ContainerClient,
  BlockBlobClient
} from '@azure/storage-blob';
import { BaseStorageService } from './base-storage.service';
import {
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
import { Readable } from 'stream';

export interface AzureBlobConfig {
  accountName: string;
  accountKey?: string;
  sasToken?: string;
  containerName: string;
  endpoint?: string;
}

interface MultipartUploadContext {
  containerClient: ContainerClient;
  blockBlobClient: BlockBlobClient;
  blockIds: string[];
}

@Injectable()
export class AzureBlobCloudStorageService extends BaseStorageService {
  readonly name = 'AzureBlob';
  readonly capabilities: CloudStorageCapabilities = {
    streaming: true,
    multipart: true,
    presignedUrls: true,
    nativeMetadata: true,
    serverSideEncryption: true,
    versioning: false,
  };

  private blobServiceClient: BlobServiceClient;
  private containerClient: ContainerClient;
  private containerName: string;
  private multipartUploads = new Map<string, MultipartUploadContext>();

  constructor(private configService: ConfigService) {
    super();
    this.initializeClient();
  }

  private initializeClient() {
    const config: AzureBlobConfig = {
      accountName: this.configService.get<string>('AZURE_STORAGE_ACCOUNT_NAME'),
      accountKey: this.configService.get<string>('AZURE_STORAGE_ACCOUNT_KEY'),
      sasToken: this.configService.get<string>('AZURE_STORAGE_SAS_TOKEN'),
      containerName: this.configService.get<string>('AZURE_STORAGE_CONTAINER_NAME', 'gytech-cloud'),
      endpoint: this.configService.get<string>('AZURE_STORAGE_ENDPOINT'),
    };

    if (!config.accountName || !config.containerName) {
      throw new Error('Azure Blob Storage configuration is incomplete');
    }

    if (!config.accountKey && !config.sasToken) {
      throw new Error('Either Azure account key or SAS token must be provided');
    }

    this.containerName = config.containerName;

    try {
      if (config.accountKey) {
        const credential = new StorageSharedKeyCredential(config.accountName, config.accountKey);
        const endpoint = config.endpoint || `https://${config.accountName}.blob.core.windows.net`;
        this.blobServiceClient = new BlobServiceClient(endpoint, credential);
      } else if (config.sasToken) {
        const endpoint = config.endpoint || `https://${config.accountName}.blob.core.windows.net`;
        this.blobServiceClient = new BlobServiceClient(`${endpoint}${config.sasToken}`);
      }

      this.containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    } catch (error) {
      this.handleStorageError(error, 'initialization');
    }
  }

  async upload(params: UploadParams): Promise<UploadResult> {
    try {
      const blobName = this.buildPath(params.path);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      const chunks: Buffer[] = [];
      
      return new Promise((resolve, reject) => {
        params.stream.on('data', (chunk) => chunks.push(chunk));
        params.stream.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            
            const uploadResponse = await blockBlobClient.upload(
              buffer,
              buffer.length,
              {
                blobHTTPHeaders: {
                  blobContentType: params.contentType,
                },
                metadata: params.metadata,
              }
            );

            resolve({
              storedPath: blobName,
              etag: uploadResponse.etag,
            });
          } catch (error) {
            this.handleStorageError(error, 'upload');
          }
        });
        params.stream.on('error', reject);
      });
    } catch (error) {
      this.handleStorageError(error, 'upload');
    }
  }

  async download(
    path: string,
    options?: DownloadOptions,
  ): Promise<NodeJS.ReadableStream> {
    try {
      const blobName = this.buildPath(path);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      const downloadOptions: any = {};
      
      if (options?.range) {
        const { start, end } = options.range;
        downloadOptions.offset = start;
        if (end !== undefined) {
          downloadOptions.count = end - start + 1;
        }
      }

      const downloadResponse = await blockBlobClient.download(
        downloadOptions.offset,
        downloadOptions.count,
      );

      if (!downloadResponse.readableStreamBody) {
        throw new Error('Failed to get readable stream from Azure Blob');
      }

      return downloadResponse.readableStreamBody;
    } catch (error) {
      this.handleStorageError(error, 'download');
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const blobName = this.buildPath(path);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      
      await blockBlobClient.delete({
        deleteSnapshots: 'include',
      });
    } catch (error) {
      this.handleStorageError(error, 'delete');
    }
  }

  async getUrl(
    path: string,
    options?: PresignedUrlOptions,
  ): Promise<string> {
    try {
      const blobName = this.buildPath(path);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      
      return blockBlobClient.url;
    } catch (error) {
      this.handleStorageError(error, 'getUrl');
    }
  }

  async getMetadata(path: string): Promise<FileMetadata> {
    try {
      const blobName = this.buildPath(path);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      
      const properties = await blockBlobClient.getProperties();

      return {
        size: properties.contentLength || 0,
        contentType: properties.contentType,
        lastModified: properties.lastModified,
        etag: properties.etag,
        metadata: properties.metadata,
      };
    } catch (error) {
      this.handleStorageError(error, 'getMetadata');
    }
  }

  async multipartInit(
    path: string,
    size?: number,
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<MultipartUploadInit> {
    try {
      const blobName = this.buildPath(path);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      
      const uploadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const uploadContext: MultipartUploadContext = {
        containerClient: this.containerClient,
        blockBlobClient,
        blockIds: [],
      };

      this.multipartUploads.set(uploadId, uploadContext);

      return {
        uploadId,
        metadata: {
          blobName,
          size,
          contentType,
          metadata,
        },
      };
    } catch (error) {
      this.handleStorageError(error, 'multipartInit');
    }
  }

  async multipartUploadPart(
    uploadId: string,
    partNumber: number,
    data: Buffer | NodeJS.ReadableStream,
    size?: number,
  ): Promise<{ etag: string }> {
    try {
      const uploadContext = this.multipartUploads.get(uploadId);
      if (!uploadContext) {
        throw new Error(`Upload context not found for uploadId: ${uploadId}`);
      }

      const buffer = Buffer.isBuffer(data) ? data : await this.streamToBuffer(data);
      const blockId = Buffer.from(`block-${partNumber.toString().padStart(6, '0')}`).toString('base64');
      
      await uploadContext.blockBlobClient.stageBlock(blockId, buffer, buffer.length);
      uploadContext.blockIds.push(blockId);

      return { etag: `part-${partNumber}` };
    } catch (error) {
      this.handleStorageError(error, 'multipartUploadPart');
    }
  }

  async multipartComplete(
    uploadId: string,
    path: string,
    parts: MultipartUploadPart[],
  ): Promise<UploadResult> {
    try {
      const uploadContext = this.multipartUploads.get(uploadId);
      if (!uploadContext) {
        throw new Error(`Upload context not found for uploadId: ${uploadId}`);
      }

      const metadata = uploadContext.blockBlobClient.getProperties().then(p => p.metadata);
      
      const commitResponse = await uploadContext.blockBlobClient.commitBlockList(
        uploadContext.blockIds,
        {
          blobHTTPHeaders: {
            blobContentType: (await metadata)?.contentType,
          },
          metadata: await metadata,
        },
      );

      this.multipartUploads.delete(uploadId);

      return {
        storedPath: path,
        etag: commitResponse.etag,
      };
    } catch (error) {
      this.multipartUploads.delete(uploadId);
      this.handleStorageError(error, 'multipartComplete');
    }
  }

  async multipartAbort(uploadId: string, path: string): Promise<void> {
    try {
      const uploadContext = this.multipartUploads.get(uploadId);
      if (uploadContext) {
        this.multipartUploads.delete(uploadId);
      }
    } catch (error) {
      this.logger.warn(`Failed to abort Azure Blob multipart upload: ${error.message}`);
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const { result, latencyMs } = await this.measureLatency(async () => {
        return await this.containerClient.getProperties();
      });

      return {
        ok: true,
        latencyMs,
        details: {
          container: this.containerName,
          lastModified: result.lastModified,
          etag: result.etag,
        },
      };
    } catch (error) {
      return {
        ok: false,
        errorMessage: error.message,
        details: { provider: this.name },
      };
    }
  }

  async listFiles(
    prefix?: string,
    limit?: number,
    continuationToken?: string,
  ) {
    try {
      const listOptions: any = {
        prefix: prefix ? this.buildPath(prefix) : undefined,
      };

      if (continuationToken) {
        listOptions.continuationToken = continuationToken;
      }

      const response = this.containerClient.listBlobsFlat(listOptions);
      const files: Array<{
        path: string;
        size: number;
        lastModified: Date;
        etag?: string;
      }> = [];

      let count = 0;
      for await (const blob of response) {
        if (limit && count >= limit) {
          break;
        }

        files.push({
          path: blob.name,
          size: blob.properties.contentLength || 0,
          lastModified: blob.properties.lastModified || new Date(),
          etag: blob.properties.etag,
        });

        count++;
      }

      return {
        files,
        continuationToken: response.continuationToken,
      };
    } catch (error) {
      this.handleStorageError(error, 'listFiles');
    }
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}