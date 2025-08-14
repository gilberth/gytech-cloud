import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class UpdateOneDriveConfigDto {
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
  tenantId?: string;

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