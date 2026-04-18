import {
  IsString,
  IsMongoId,
  IsOptional,
  IsNumber,
  IsArray,
} from 'class-validator';

export class PublishCampaignDto {
  @IsString()
  @IsMongoId()
  campaignId: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  objective?: string;

  @IsNumber()
  @IsOptional()
  dailyBudget?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetCountries?: string[];

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;
}
