import { IsEnum } from 'class-validator';
import { Language } from '../../../common/constants';

export class UpdateLanguageDto {
  @IsEnum(Language)
  language: Language;
}
