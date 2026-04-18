import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpdatePaymentMethodDto {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsObject()
  config: Record<string, any>;
}
