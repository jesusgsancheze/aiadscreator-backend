import {
  IsString,
  IsMongoId,
  IsOptional,
  IsNumber,
  IsArray,
  IsIn,
  Min,
  Max,
} from 'class-validator';

const ALLOWED_BIDDING = [
  'MAXIMIZE_CONVERSIONS',
  'MAXIMIZE_CONVERSION_VALUE',
  'TARGET_CPA',
  'TARGET_ROAS',
];

const ALLOWED_CTAS = [
  'LEARN_MORE',
  'SHOP_NOW',
  'SIGN_UP',
  'GET_QUOTE',
  'CONTACT_US',
  'DOWNLOAD',
  'BOOK_NOW',
];

export class PublishPmaxDto {
  @IsString()
  @IsMongoId()
  campaignId: string;

  // Campaign-level overrides (defaulted from campaign.googleAdsSuggestion)
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  dailyBudget?: number; // USD whole units

  @IsString()
  @IsIn(ALLOWED_BIDDING)
  @IsOptional()
  biddingStrategy?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  targetCpa?: number; // USD whole units, only when biddingStrategy === TARGET_CPA

  @IsNumber()
  @Min(0.1)
  @Max(100)
  @IsOptional()
  targetRoas?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  countries?: string[]; // ISO-2

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  languages?: string[]; // ISO-639-1

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  finalUrls?: string[];

  @IsString()
  @IsIn(ALLOWED_CTAS)
  @IsOptional()
  callToAction?: string;

  @IsString()
  @IsOptional()
  startDate?: string; // YYYY-MM-DD

  @IsString()
  @IsOptional()
  endDate?: string;
}
