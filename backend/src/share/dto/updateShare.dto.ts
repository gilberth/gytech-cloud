import { Type } from "class-transformer";
import {
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { ShareSecurityDTO } from "./shareSecurity.dto";

export class UpdateShareDTO {
  @IsOptional()
  @IsString()
  @Length(3, 30)
  name?: string;

  @IsOptional()
  @IsString()
  expiration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @ValidateNested()
  @Type(() => ShareSecurityDTO)
  @IsOptional()
  security?: ShareSecurityDTO;
}