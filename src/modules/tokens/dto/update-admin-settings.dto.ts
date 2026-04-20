import { IsArray, IsNotEmpty } from 'class-validator';

export class UpdateAdminSettingsDto {
  @IsNotEmpty()
  value: any;
}
