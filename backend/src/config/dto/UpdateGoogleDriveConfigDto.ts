import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from "class-validator";

enum ConfigGoogleDriveKeys {
  ENABLED = "googledrive.enabled",
  CLIENT_ID = "googledrive.clientId",
  CLIENT_SECRET = "googledrive.clientSecret",
  REDIRECT_URI = "googledrive.redirectUri",
  FOLDER_ID = "googledrive.folderId",
  SERVICE_ACCOUNT_KEY = "googledrive.serviceAccountKey",
}

export class UpdateGoogleDriveConfigDto {
  @IsEnum(ConfigGoogleDriveKeys)
  key: ConfigGoogleDriveKeys;

  @ValidateIf((object, value) => {
    return object.key == ConfigGoogleDriveKeys.ENABLED;
  })
  @IsBoolean()
  @IsOptional()
  value?: boolean;

  @ValidateIf((object, value) => {
    return [
      ConfigGoogleDriveKeys.CLIENT_ID,
      ConfigGoogleDriveKeys.CLIENT_SECRET,
      ConfigGoogleDriveKeys.REDIRECT_URI,
      ConfigGoogleDriveKeys.FOLDER_ID,
    ].includes(object.key);
  })
  @IsString()
  @IsOptional()
  @Length(0, 2048)
  value?: string;

  @ValidateIf((object, value) => {
    return object.key == ConfigGoogleDriveKeys.SERVICE_ACCOUNT_KEY;
  })
  @IsString()
  @IsOptional()
  @Length(0, 10240)
  value?: string;
}