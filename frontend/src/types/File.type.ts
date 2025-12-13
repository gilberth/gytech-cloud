export type FileUpload = File & { uploadingProgress: number };

export type FileUploadResponse = { id: string; name: string };

export type FileMetaData = {
  id: string;
  name: string;
  size: string;
  publicToken?: string;
};

export type FileListItem = FileUpload | (FileMetaData & { deleted?: boolean });
