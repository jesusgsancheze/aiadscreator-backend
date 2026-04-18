import { IsEnum, IsString, IsMongoId, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { SocialMedia } from '../../../common/constants';

export class CreateCampaignDto {
  @IsEnum(SocialMedia)
  socialMedia: SocialMedia;

  @IsString()
  campaignDescription: string;

  @IsString()
  imageDescription: string;

  @IsString()
  @IsMongoId()
  clientId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  imageCount?: number;
}
