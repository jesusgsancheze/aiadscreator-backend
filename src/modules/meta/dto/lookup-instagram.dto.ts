import { IsString, MinLength } from 'class-validator';

export class LookupInstagramDto {
  @IsString()
  @MinLength(1)
  accessToken: string;

  @IsString()
  @MinLength(1)
  pageId: string;
}
