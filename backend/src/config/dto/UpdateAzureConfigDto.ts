import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from "class-validator";

enum ConfigAzureKeys {
  ENABLED = "azure.enabled",
  ACCOUNT_NAME = "azure.accountName",
  ACCOUNT_KEY = "azure.accountKey",
  CONNECTION_STRING = "azure.connectionString",
  CONTAINER_NAME = "azure.containerName",
  ENDPOINT_URL = "azure.endpointUrl",
  FOLDER_PATH = "azure.folderPath",
}

export class UpdateAzureConfigDto {
  @IsEnum(ConfigAzureKeys)
  key: ConfigAzureKeys;

  @ValidateIf((object, value) => {
    return object.key == ConfigAzureKeys.ENABLED;
  })
  @IsBoolean()
  @IsOptional()
  value?: boolean;

  @ValidateIf((object, value) => {
    return [
      ConfigAzureKeys.ACCOUNT_NAME,
      ConfigAzureKeys.ACCOUNT_KEY,
      ConfigAzureKeys.CONNECTION_STRING,
      ConfigAzureKeys.CONTAINER_NAME,
      ConfigAzureKeys.ENDPOINT_URL,
      ConfigAzureKeys.FOLDER_PATH,
    ].includes(object.key);
  })
  @IsString()
  @IsOptional()
  @Length(0, 2048)
  value?: string;
}