import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CampaignsService } from './campaigns.service';
import { AiService } from '../ai/ai.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { UpdatePerformanceDto } from './dto/update-performance.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ObjectIdValidationPipe } from '../../common/pipes/object-id-validation.pipe';
import { UploadService } from '../upload/upload.service';

@UseGuards(JwtAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly aiService: AiService,
    private readonly uploadService: UploadService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('productImage'))
  async create(
    @Body() dto: CreateCampaignDto,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Product image is required.');
    }
    const imagePath = await this.uploadService.saveFile(file);
    return this.campaignsService.create(dto, userId, imagePath);
  }

  @Get()
  findAll(
    @CurrentUser('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('socialMedia') socialMedia?: string,
  ) {
    return this.campaignsService.findAllByUser(userId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      socialMedia,
    });
  }

  @Get(':id')
  findOne(@Param('id', ObjectIdValidationPipe) id: string) {
    return this.campaignsService.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.update(id, userId, dto);
  }

  @Patch(':id/performance')
  updatePerformance(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdatePerformanceDto,
  ) {
    return this.campaignsService.updatePerformance(id, userId, dto);
  }

  @Patch(':id/select-image')
  selectImage(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
    @Body('imageIndex') imageIndex: number,
  ) {
    return this.campaignsService.selectImage(id, userId, imageIndex);
  }

  @Post(':id/generate')
  async generate(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
  ) {
    // Verify ownership first
    const campaign = await this.campaignsService.findById(id);
    if (campaign.userId.toString() !== userId) {
      throw new BadRequestException('You do not own this campaign.');
    }
    // Trigger AI generation asynchronously
    this.aiService.generateCampaignContent(id).catch(() => {
      // Error handling is done inside the service (status set to FAILED)
    });
    return { message: 'AI content generation in progress...' };
  }

  @Delete(':id')
  delete(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.campaignsService.delete(id, userId);
  }
}
