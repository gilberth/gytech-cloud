import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class UpdateAzureConfigDto {
  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  accountKey?: string;

  @IsOptional()
  @IsString()
  sasToken?: string;

  @IsOptional()
  @IsString()
  containerName?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

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