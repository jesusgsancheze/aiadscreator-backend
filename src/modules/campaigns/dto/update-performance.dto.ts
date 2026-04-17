import { IsOptional, IsNumber } from 'class-validator';

export class UpdatePerformanceDto {
  @IsOptional()
  @IsNumber()
  impressions?: number;

  @IsOptional()
  @IsNumber()
  clicks?: number;

  @IsOptional()
  @IsNumber()
  conversions?: number;

  @IsOptional()
  @IsNumber()
  engagement?: number;

  @IsOptional()
  @IsNumber()
  reach?: number;

  @IsOptional()
  @IsNumber()
  ctr?: number;

  @IsOptional()
  @IsNumber()
  spent?: number;
}
