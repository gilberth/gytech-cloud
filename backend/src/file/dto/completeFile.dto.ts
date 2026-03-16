import { IsString, IsInt, Min } from "class-validator";

export class CompleteFileDto {
  @IsString()
  fileName: string;

  @IsInt()
  @Min(1)
  totalChunks: number;
}
