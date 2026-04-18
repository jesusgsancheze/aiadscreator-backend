import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsMongoId } from 'class-validator';

export class AdminGrantTokensDto {
  @IsString()
  @IsMongoId()
  userId: string;

  @IsNumber()
  @Min(1)
  tokens: number;

  @IsString()
  @IsOptional()
  adminNote?: string;
}
