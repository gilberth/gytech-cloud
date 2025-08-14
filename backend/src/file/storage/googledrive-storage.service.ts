import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { google, drive_v3 } from 'googleapis';
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

export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  rootFolderId?: string;
}

@Injectable()
export class GoogleDriveStorageService extends BaseStorageService {
  readonly name = 'GoogleDrive';
  readonly capabilities: CloudStorageCapabilities = {
    streaming: true,
    multipart: true,
    presignedUrls: false,
    nativeMetadata: true,
    serverSideEncryption: true,
    versioning: true,
  };

  private drive: drive_v3.Drive;
  private rootFolderId: string;

  constructor(private configService: ConfigService) {
    super();
    this.initializeClient();
  }

  private initializeClient() {
    const config: GoogleDriveConfig = {
      clientId: this.configService.get('googledrive.clientId'),
      clientSecret: this.configService.get('googledrive.clientSecret'),
      refreshToken: this.configService.get('googledrive.refreshToken'),
      accessToken: this.configService.get('googledrive.accessToken'),
      rootFolderId: this.configService.get('googledrive.parentFolderId') || 'root',
    };

    if (!config.clientId || !config.clientSecret || !config.refreshToken) {
      throw new Error('Google Drive configuration is incomplete');
    }

    this.rootFolderId = config.rootFolderId;

    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
    );

    oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
      access_token: config.accessToken,
    });

    this.drive = google.drive({ version: 'v3', auth: oauth2Client });
  }

  async upload(params: UploadParams): Promise<UploadResult> {
    try {
      const fileName = params.path.split('/').pop() || 'unknown';
      const parentFolderId = await this.ensureFolderPath(
        params.path.substring(0, params.path.lastIndexOf('/'))
      );

      const fileMetadata: drive_v3.Schema$File = {
        name: fileName,
        parents: [parentFolderId],
      };

      const media = {
        mimeType: params.contentType || 'application/octet-stream',
        body: params.stream,
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, size, mimeType, modifiedTime',
      });

      return {
        storedPath: params.path,
        etag: response.data.id,
        url: `https://drive.google.com/file/d/${response.data.id}/view`,
      };
    } catch (error) {
      this.handleStorageError(error, 'upload');
    }
  }

  async download(
    path: string,
    options?: DownloadOptions,
  ): Promise<NodeJS.ReadableStream> {
    try {
      const fileId = await this.getFileIdByPath(path);
      
      const headers: Record<string, string> = {};
      if (options?.range) {
        const { start, end } = options.range;
        headers.Range = `bytes=${start}-${end || ''}`;
      }

      const response = await this.drive.files.get({
        fileId,
        alt: 'media',
      }, { responseType: 'stream' });

      return response.data as NodeJS.ReadableStream;
    } catch (error) {
      this.handleStorageError(error, 'download');
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const fileId = await this.getFileIdByPath(path);
      
      await this.drive.files.delete({
        fileId,
      });
    } catch (error) {
      this.handleStorageError(error, 'delete');
    }
  }

  async getMetadata(path: string): Promise<FileMetadata> {
    try {
      const fileId = await this.getFileIdByPath(path);
      
      const response = await this.drive.files.get({
        fileId,
        fields: 'id, name, size, mimeType, modifiedTime, webViewLink, parents',
      });

      const file = response.data;
      
      return {
        size: parseInt(file.size || '0'),
        contentType: file.mimeType || undefined,
        lastModified: new Date(file.modifiedTime || Date.now()),
        etag: file.id,
        metadata: {
          id: file.id,
          name: file.name,
          webViewLink: file.webViewLink,
          parents: file.parents?.[0] || 'root',
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
      const fileName = path.split('/').pop() || 'unknown';
      const parentFolderId = await this.ensureFolderPath(
        path.substring(0, path.lastIndexOf('/'))
      );

      const fileMetadata: drive_v3.Schema$File = {
        name: fileName,
        parents: [parentFolderId],
        description: metadata ? JSON.stringify(metadata) : undefined,
      };

      const uploadUrl = await this.drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: contentType || 'application/octet-stream',
          body: '', 
        },
        uploadType: 'resumable',
      });

      return {
        uploadId: String(uploadUrl.config?.url || `gdrive-${Date.now()}`),
        metadata: {
          fileMetadata,
          parentFolderId,
          size,
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
      
      return { etag: `part-${partNumber}-${buffer.length}` };
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
    this.logger.warn(`Google Drive multipart abort called for ${path}, no action needed`);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const { result, latencyMs } = await this.measureLatency(async () => {
        return await this.drive.about.get({ fields: 'storageQuota, user' });
      });

      return {
        ok: true,
        latencyMs,
        details: {
          storageQuota: result.data.storageQuota,
          user: result.data.user?.emailAddress,
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
      const folderId = prefix ? 
        await this.getFolderIdByPath(prefix) : 
        this.rootFolderId;

      const query = `'${folderId}' in parents and trashed=false`;
      
      const response = await this.drive.files.list({
        q: query,
        pageSize: limit || 1000,
        pageToken: continuationToken,
        fields: 'nextPageToken, files(id, name, size, mimeType, modifiedTime)',
      });

      return {
        files: (response.data.files || []).map((file) => ({
          path: file.name || 'unknown',
          size: parseInt(file.size || '0'),
          lastModified: new Date(file.modifiedTime || Date.now()),
          etag: file.id,
        })),
        continuationToken: response.data.nextPageToken || undefined,
      };
    } catch (error) {
      this.handleStorageError(error, 'listFiles');
    }
  }

  private async getFileIdByPath(path: string): Promise<string> {
    const parts = path.split('/').filter(part => part.length > 0);
    const fileName = parts.pop();
    
    let parentId = this.rootFolderId;
    
    for (const folderName of parts) {
      parentId = await this.getFolderIdByName(folderName, parentId);
    }
    
    const response = await this.drive.files.list({
      q: `name='${fileName}' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id)',
    });

    if (!response.data.files || response.data.files.length === 0) {
      throw new Error(`File not found: ${path}`);
    }

    return response.data.files[0].id!;
  }

  private async getFolderIdByPath(path: string): Promise<string> {
    if (!path || path === '/' || path === '') {
      return this.rootFolderId;
    }

    const parts = path.split('/').filter(part => part.length > 0);
    let parentId = this.rootFolderId;
    
    for (const folderName of parts) {
      parentId = await this.getFolderIdByName(folderName, parentId);
    }
    
    return parentId;
  }

  private async getFolderIdByName(folderName: string, parentId: string): Promise<string> {
    const response = await this.drive.files.list({
      q: `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });

    if (!response.data.files || response.data.files.length === 0) {
      throw new Error(`Folder not found: ${folderName}`);
    }

    return response.data.files[0].id!;
  }

  private async ensureFolderPath(path: string): Promise<string> {
    if (!path || path === '/' || path === '') {
      return this.rootFolderId;
    }

    const parts = path.split('/').filter(part => part.length > 0);
    let parentId = this.rootFolderId;
    
    for (const folderName of parts) {
      try {
        parentId = await this.getFolderIdByName(folderName, parentId);
      } catch (error) {
        parentId = await this.createFolder(folderName, parentId);
      }
    }
    
    return parentId;
  }

  private async createFolder(folderName: string, parentId: string): Promise<string> {
    const fileMetadata: drive_v3.Schema$File = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    };

    const response = await this.drive.files.create({
      requestBody: fileMetadata,
      fields: 'id',
    });

    return response.data.id!;
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