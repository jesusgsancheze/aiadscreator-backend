import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Language } from '../../../common/constants';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  firstName: string;

  @IsString()
  @MinLength(2)
  lastName: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsEnum(Language)
  language?: Language;
}
