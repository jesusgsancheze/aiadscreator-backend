import {
  IsString,
  IsMongoId,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsIn,
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

  @IsString()
  @IsOptional()
  optimizationGoal?: string;

  @IsString()
  @IsOptional()
  billingEvent?: string;

  @IsInt()
  @Min(13)
  @Max(65)
  @IsOptional()
  ageMin?: number;

  @IsInt()
  @Min(13)
  @Max(65)
  @IsOptional()
  ageMax?: number;

  @IsArray()
  @IsInt({ each: true })
  @IsIn([1, 2], { each: true })
  @IsOptional()
  genders?: number[];

  @IsBoolean()
  @IsOptional()
  advantageAudience?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  interests?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  publisherPlatforms?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  facebookPositions?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  instagramPositions?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  messengerPositions?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  audienceNetworkPositions?: string[];

  @IsBoolean()
  @IsOptional()
  useAdvantagePlacements?: boolean;
}
