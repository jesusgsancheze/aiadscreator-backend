import { IsInt, IsOptional, IsString, IsEnum, Min, Max } from 'class-validator';
import { ImageAgent } from '../../../common/constants';

export class GenerateImagesDto {
  @IsInt()
  @Min(1)
  @Max(10)
  count: number;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsEnum(ImageAgent)
  imageAgent?: ImageAgent;
}
