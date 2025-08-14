import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { AuthenticationProvider, Client } from '@microsoft/microsoft-graph-client';
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

export interface OneDriveConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  refreshToken?: string;
  accessToken?: string;
  rootPath?: string;
}

class OneDriveAuthProvider implements AuthenticationProvider {
  private accessToken: string | null = null;
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;
  private tenantId: string;

  constructor(config: OneDriveConfig) {
    this.accessToken = config.accessToken || null;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.tenantId = config.tenantId;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const response = await fetch(
      `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/Files.ReadWrite.All offline_access',
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to refresh OneDrive token: ${response.statusText}`);
    }

    const data: any = await response.json();
    this.accessToken = data.access_token;
    
    return this.accessToken;
  }
}

@Injectable()
export class OneDriveStorageService extends BaseStorageService {
  readonly name = 'OneDrive';
  readonly capabilities: CloudStorageCapabilities = {
    streaming: true,
    multipart: true,
    presignedUrls: false,
    nativeMetadata: true,
    serverSideEncryption: true,
    versioning: true,
  };

  private client: Client;
  private rootPath: string;

  constructor(private configService: ConfigService) {
    super();
    this.initializeClient();
  }

  private initializeClient() {
    const config: OneDriveConfig = {
      clientId: this.configService.get('onedrive.clientId'),
      clientSecret: this.configService.get('onedrive.clientSecret'),
      tenantId: this.configService.get('onedrive.tenantId'),
      refreshToken: this.configService.get('onedrive.refreshToken'),
      rootPath: this.configService.get('onedrive.rootPath') || '/',
    };

    if (!config.clientId || !config.clientSecret || !config.tenantId) {
      throw new Error('OneDrive configuration is incomplete');
    }

    this.rootPath = config.rootPath;
    const authProvider = new OneDriveAuthProvider(config);
    this.client = Client.initWithMiddleware({ authProvider });
  }

  async upload(params: UploadParams): Promise<UploadResult> {
    try {
      const filePath = this.buildPath(`${this.rootPath}/${params.path}`);
      
      const chunks: Buffer[] = [];
      
      return new Promise((resolve, reject) => {
        params.stream.on('data', (chunk) => chunks.push(chunk));
        params.stream.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            
            const response = await this.client
              .api(`/me/drive/root:/${filePath}:/content`)
              .putStream(buffer);

            resolve({
              storedPath: filePath,
              etag: response.eTag,
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
      const filePath = this.buildPath(`${this.rootPath}/${path}`);
      const headers: Record<string, string> = {};
      
      if (options?.range) {
        const { start, end } = options.range;
        headers.Range = `bytes=${start}-${end || ''}`;
      }

      const response = await this.client
        .api(`/me/drive/root:/${filePath}:/content`)
        .headers(headers)
        .getStream();

      return response;
    } catch (error) {
      this.handleStorageError(error, 'download');
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const filePath = this.buildPath(`${this.rootPath}/${path}`);
      
      await this.client
        .api(`/me/drive/root:/${filePath}`)
        .delete();
    } catch (error) {
      this.handleStorageError(error, 'delete');
    }
  }

  async getMetadata(path: string): Promise<FileMetadata> {
    try {
      const filePath = this.buildPath(`${this.rootPath}/${path}`);
      
      const response = await this.client
        .api(`/me/drive/root:/${filePath}`)
        .get();

      return {
        size: response.size,
        contentType: response.file?.mimeType,
        lastModified: new Date(response.lastModifiedDateTime),
        etag: response.eTag,
        metadata: {
          id: response.id,
          name: response.name,
          webUrl: response.webUrl,
        },
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
      const filePath = this.buildPath(`${this.rootPath}/${path}`);
      
      const uploadSession = await this.client
        .api(`/me/drive/root:/${filePath}:/createUploadSession`)
        .post({
          item: {
            '@microsoft.graph.conflictBehavior': 'replace',
            name: path.split('/').pop(),
            ...(metadata && { description: JSON.stringify(metadata) }),
          },
        });

      return {
        uploadId: uploadSession.uploadUrl,
        metadata: {
          uploadUrl: uploadSession.uploadUrl,
          expirationDateTime: uploadSession.expirationDateTime,
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
      const buffer = Buffer.isBuffer(data) ? data : await this.streamToBuffer(data);
      const chunkSize = 327680; // 320KB chunks for OneDrive
      const start = (partNumber - 1) * chunkSize;
      const end = Math.min(start + buffer.length - 1, size ? size - 1 : buffer.length - 1);

      const response = await fetch(uploadId, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${start}-${end}/${size || buffer.length}`,
          'Content-Length': buffer.length.toString(),
        },
        body: buffer,
      });

      if (!response.ok) {
        throw new Error(`Upload part failed: ${response.statusText}`);
      }

      const result: any = await response.json();
      return { etag: result.eTag || `part-${partNumber}` };
    } catch (error) {
      this.handleStorageError(error, 'multipartUploadPart');
    }
  }

  async multipartComplete(
    uploadId: string,
    path: string,
    parts: MultipartUploadPart[],
  ): Promise<UploadResult> {
    return {
      storedPath: path,
      etag: `completed-${Date.now()}`,
    };
  }

  async multipartAbort(uploadId: string, path: string): Promise<void> {
    try {
      await fetch(uploadId, {
        method: 'DELETE',
      });
    } catch (error) {
      this.logger.warn(`Failed to abort OneDrive upload session: ${error.message}`);
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const { result, latencyMs } = await this.measureLatency(async () => {
        return await this.client.api('/me/drive').get();
      });

      return {
        ok: true,
        latencyMs,
        details: {
          driveType: result.driveType,
          quota: result.quota,
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
      const folderPath = this.buildPath(`${this.rootPath}/${prefix || ''}`);
      let query = this.client.api(`/me/drive/root:/${folderPath}:/children`);
      
      if (limit) {
        query = query.top(limit);
      }
      
      if (continuationToken) {
        query = query.skipToken(continuationToken);
      }

      const response = await query.get();

      return {
        files: response.value.map((item: any) => ({
          path: item.name,
          size: item.size,
          lastModified: new Date(item.lastModifiedDateTime),
          etag: item.eTag,
        })),
        continuationToken: response['@odata.nextLink'] ? 
          new URL(response['@odata.nextLink']).searchParams.get('$skiptoken') : 
          undefined,
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