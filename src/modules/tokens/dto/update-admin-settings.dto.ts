import { Allow } from 'class-validator';

export class UpdateAdminSettingsDto {
  @Allow()
  value: any;
}
