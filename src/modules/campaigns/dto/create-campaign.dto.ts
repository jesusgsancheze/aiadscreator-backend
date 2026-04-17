import { IsEnum, IsString, IsMongoId } from 'class-validator';
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
}
