import { PartialType } from '@nestjs/mapped-types';
import { CreateMetaConnectionDto } from './create-meta-connection.dto';

export class UpdateMetaConnectionDto extends PartialType(
  CreateMetaConnectionDto,
) {}
