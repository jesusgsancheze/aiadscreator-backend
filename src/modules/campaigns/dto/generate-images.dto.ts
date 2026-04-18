import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class GenerateImagesDto {
  @IsInt()
  @Min(1)
  @Max(10)
  count: number;

  @IsOptional()
  @IsString()
  instructions?: string;
}
