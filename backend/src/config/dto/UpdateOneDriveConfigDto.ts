import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from "class-validator";

enum ConfigOneDriveKeys {
  ENABLED = "onedrive.enabled",
  CLIENT_ID = "onedrive.clientId",
  CLIENT_SECRET = "onedrive.clientSecret",
  TENANT_ID = "onedrive.tenantId",
  FOLDER_PATH = "onedrive.folderPath",
  REDIRECT_URI = "onedrive.redirectUri",
}

export class UpdateOneDriveConfigDto {
  @IsEnum(ConfigOneDriveKeys)
  key: ConfigOneDriveKeys;

  @ValidateIf((object, value) => {
    return object.key == ConfigOneDriveKeys.ENABLED;
  })
  @IsBoolean()
  @IsOptional()
  value?: boolean;

  @ValidateIf((object, value) => {
    return [
      ConfigOneDriveKeys.CLIENT_ID,
      ConfigOneDriveKeys.CLIENT_SECRET,
      ConfigOneDriveKeys.TENANT_ID,
      ConfigOneDriveKeys.FOLDER_PATH,
      ConfigOneDriveKeys.REDIRECT_URI,
    ].includes(object.key);
  })
  @IsString()
  @IsOptional()
  @Length(0, 2048)
  value?: string;
}