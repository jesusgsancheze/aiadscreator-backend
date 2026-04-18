import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ReviewTransactionDto {
  @IsEnum(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsString()
  @IsOptional()
  adminNote?: string;
}
