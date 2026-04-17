import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ObjectIdValidationPipe } from '../../common/pipes/object-id-validation.pipe';
import { UploadService } from '../upload/upload.service';

@UseGuards(JwtAuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly uploadService: UploadService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('logo'))
  async create(
    @Body() dto: CreateClientDto,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let logoPath: string | null = null;
    if (file) {
      logoPath = await this.uploadService.saveFile(file);
    }
    return this.clientsService.create(dto, userId, logoPath);
  }

  @Get()
  findAll(@CurrentUser('userId') userId: string) {
    return this.clientsService.findAllByUser(userId);
  }

  @Get(':id')
  findOne(@Param('id', ObjectIdValidationPipe) id: string) {
    return this.clientsService.findById(id);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('logo'))
  async update(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateClientDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let logoPath: string | undefined;
    if (file) {
      logoPath = await this.uploadService.saveFile(file);
    }
    return this.clientsService.update(id, userId, dto, logoPath);
  }

  @Delete(':id')
  delete(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.clientsService.delete(id, userId);
  }
}
