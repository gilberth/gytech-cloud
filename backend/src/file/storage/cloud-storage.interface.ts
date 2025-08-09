import { Readable } from "stream";

/**
 * Cloud Storage Provider Types
 */
export enum StorageProvider {
  LOCAL = "LOCAL",
  S3 = "S3", 
  ONEDRIVE = "ONEDRIVE",
  GOOGLE_DRIVE = "GOOGLE_DRIVE",
  AZURE_BLOB = "AZURE_BLOB"
}

/**
 * File metadata structure returned by storage providers
 */
export interface FileMetadata {
  id: string;
  name: string;
  size: string;
  shareId: string;
  createdAt: Date;
  mimeType: string | false;
}

/**
 * File object with metadata and content stream
 */
export interface StorageFile {
  metaData: FileMetadata;
  file: Readable;
}

/**
 * Chunked upload context for managing multi-part uploads
 */
export interface ChunkContext {
  index: number;
  total: number;
}

/**
 * File creation context
 */
export interface FileContext {
  id?: string;
  name: string;
}

/**
 * Storage provider configuration interface
 */
export interface StorageProviderConfig {
  provider: StorageProvider;
  enabled: boolean;
  config: Record<string, any>;
}

/**
 * Abstract interface for cloud storage providers
 * All storage services must implement these methods
 */
export interface CloudStorageService {
  /**
   * Storage provider identifier
   */
  readonly provider: StorageProvider;

  /**
   * Initialize the storage service with configuration
   * @param config Provider-specific configuration
   */
  initialize(config: Record<string, any>): Promise<void>;

  /**
   * Test connectivity and authentication with the storage provider
   * @returns Promise<boolean> true if connection is successful
   */
  testConnection(): Promise<boolean>;

  /**
   * Create/upload a file chunk to the storage provider
   * @param data Base64 encoded chunk data
   * @param chunk Chunk index and total information
   * @param file File context with ID and name
   * @param shareId Share identifier
   * @returns Promise with file context
   */
  create(
    data: string,
    chunk: ChunkContext,
    file: FileContext,
    shareId: string,
  ): Promise<FileContext>;

  /**
   * Retrieve a file from the storage provider
   * @param shareId Share identifier
   * @param fileId File identifier
   * @returns Promise with file and metadata
   */
  get(shareId: string, fileId: string): Promise<StorageFile>;

  /**
   * Remove a single file from the storage provider
   * @param shareId Share identifier  
   * @param fileId File identifier
   */
  remove(shareId: string, fileId: string): Promise<void>;

  /**
   * Delete all files for a share from the storage provider
   * @param shareId Share identifier
   */
  deleteAllFiles(shareId: string): Promise<void>;

  /**
   * Create and return a ZIP archive stream of all files in a share
   * @param shareId Share identifier
   * @returns Promise with ZIP stream
   */
  getZip(shareId: string): Promise<Readable>;

  /**
   * Get the file size in bytes
   * @param shareId Share identifier
   * @param fileName File name
   * @returns Promise with file size in bytes
   */
  getFileSize(shareId: string, fileName: string): Promise<number>;

  /**
   * Get available storage space (if supported by provider)
   * @returns Promise with available bytes, or null if not supported
   */
  getAvailableSpace(): Promise<number | null>;

  /**
   * List all files in a share (useful for management/migration)
   * @param shareId Share identifier
   * @returns Promise with array of file metadata
   */
  listFiles(shareId: string): Promise<FileMetadata[]>;

  /**
   * Check if the provider supports a specific feature
   * @param feature Feature name
   * @returns boolean indicating support
   */
  supportsFeature(feature: StorageFeature): boolean;

  /**
   * Migrate files from another storage provider
   * @param sourceProvider Source storage provider instance
   * @param shareId Share identifier
   * @param fileIds Array of file IDs to migrate
   * @returns Promise with migration results
   */
  migrateFiles(
    sourceProvider: CloudStorageService,
    shareId: string,
    fileIds: string[]
  ): Promise<MigrationResult>;
}

/**
 * Storage features that providers may or may not support
 */
export enum StorageFeature {
  CHUNKED_UPLOAD = "chunked_upload",
  DIRECT_DOWNLOAD = "direct_download", 
  SPACE_QUOTA = "space_quota",
  FILE_VERSIONING = "file_versioning",
  BATCH_OPERATIONS = "batch_operations",
  STREAMING_UPLOAD = "streaming_upload"
}

/**
 * Migration result interface
 */
export interface MigrationResult {
  success: boolean;
  migratedFiles: string[];
  failedFiles: Array<{ fileId: string; error: string }>;
  totalSize: number;
}

/**
 * Storage provider factory interface
 */
export interface StorageProviderFactory {
  createProvider(provider: StorageProvider): CloudStorageService;
  getAvailableProviders(): StorageProvider[];
  validateProviderConfig(provider: StorageProvider, config: Record<string, any>): boolean;
}