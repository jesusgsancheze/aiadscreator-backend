import { IsNumber, IsOptional, IsString, IsEnum, Min } from 'class-validator';
import { PaymentMethodType } from '../../../common/constants';

export class CreateTransactionDto {
  @IsNumber()
  @Min(1)
  tokens: number;

  @IsNumber()
  @IsOptional()
  amountUsd?: number;

  @IsEnum(PaymentMethodType)
  paymentMethod: PaymentMethodType;

  @IsString()
  @IsOptional()
  paymentReference?: string;

  @IsString()
  @IsOptional()
  packageId?: string;
}
