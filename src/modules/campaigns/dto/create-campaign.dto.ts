import { IsEnum, IsString, IsMongoId, IsOptional, IsInt, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { SocialMedia, TextAgent, ImageAgent } from '../../../common/constants';

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

  @IsOptional()
  @IsEnum(TextAgent)
  textAgent?: TextAgent;

  @IsOptional()
  @IsEnum(TextAgent)
  imagePromptAgent?: TextAgent;

  @IsOptional()
  @IsEnum(ImageAgent)
  imageAgent?: ImageAgent;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  preserveProduct?: boolean;
}
