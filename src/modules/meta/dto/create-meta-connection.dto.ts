import { IsString, IsMongoId, IsOptional, Matches } from 'class-validator';

export class CreateMetaConnectionDto {
  @IsString()
  @IsMongoId()
  clientId: string;

  @IsString()
  accessToken: string;

  @IsString()
  @Matches(/^act_\d+$/, {
    message: 'adAccountId must match the format act_XXXXXXXXX',
  })
  adAccountId: string;

  @IsString()
  pageId: string;

  @IsString()
  @IsOptional()
  instagramAccountId?: string;
}
