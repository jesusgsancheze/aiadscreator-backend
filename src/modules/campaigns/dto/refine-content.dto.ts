import { IsString, MinLength } from 'class-validator';

export class RefineContentDto {
  @IsString()
  @MinLength(5)
  instructions: string;
}
