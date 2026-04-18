import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString, IsNumber } from 'class-validator';
import { CreateCampaignDto } from './create-campaign.dto';

export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {
  @IsOptional()
  @IsString()
  copy?: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  imagePrompt?: string;

  @IsOptional()
  @IsString()
  socialMediaLink?: string;

  @IsOptional()
  @IsNumber()
  selectedImage?: number;
}
