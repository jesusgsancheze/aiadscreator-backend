import { IsString, Matches, IsOptional } from 'class-validator';

export class SelectCustomerDto {
  // Google Ads customer IDs are 10 digits, no dashes.
  @IsString()
  @Matches(/^\d{10}$/)
  customerId: string;

  @IsString()
  @Matches(/^\d{10}$/)
  @IsOptional()
  loginCustomerId?: string;
}
