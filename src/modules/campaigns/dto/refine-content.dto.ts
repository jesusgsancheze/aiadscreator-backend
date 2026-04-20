import { IsString, IsEnum, IsOptional, MinLength } from 'class-validator';
import { TextAgent } from '../../../common/constants';

export class RefineContentDto {
  @IsString()
  @MinLength(5)
  instructions: string;

  @IsOptional()
  @IsEnum(TextAgent)
  textAgent?: TextAgent;
}
