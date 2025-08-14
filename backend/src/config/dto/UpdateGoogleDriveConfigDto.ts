import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class UpdateGoogleDriveConfigDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  authUri?: string;

  @IsOptional()
  @IsString()
  tokenUri?: string;

  @IsOptional()
  @IsString()
  scopes?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  primary?: boolean;

  @IsOptional()
  @IsBoolean()
  fallback?: boolean;
}