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
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CampaignsService } from './campaigns.service';
import { AiService } from '../ai/ai.service';
import { OpenRouterService } from '../ai/openrouter.service';
import { TokensService } from '../tokens/tokens.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { UpdatePerformanceDto } from './dto/update-performance.dto';
import { RefineContentDto } from './dto/refine-content.dto';
import { GenerateImagesDto } from './dto/generate-images.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ObjectIdValidationPipe } from '../../common/pipes/object-id-validation.pipe';
import { UploadService } from '../upload/upload.service';
import { TOKEN_COSTS } from '../../common/constants';

@UseGuards(JwtAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly aiService: AiService,
    private readonly openRouterService: OpenRouterService,
    private readonly uploadService: UploadService,
    private readonly tokensService: TokensService,
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

    // Check token balance before generating
    const imageCount = campaign.imageCount || 3;
    const { canAfford, balance, cost } =
      await this.tokensService.canAffordCampaign(userId, imageCount);
    if (!canAfford) {
      throw new BadRequestException(
        `Insufficient tokens. You need ${cost} tokens but only have ${balance}.`,
      );
    }

    // Charge tokens
    await this.tokensService.chargeCampaign(userId, imageCount, id);

    // Trigger AI generation — run in background but log errors
    this.aiService.generateCampaignContent(id).catch((err) => {
      console.error('AI generation failed:', err.message);
    });
    return { message: 'AI content generation in progress...', campaignId: id };
  }

  @Post(':id/refine-copy')
  async refineCopy(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: RefineContentDto,
  ) {
    const campaign = await this.campaignsService.findById(id);
    if (campaign.userId.toString() !== userId) {
      throw new BadRequestException('You do not own this campaign.');
    }
    if (!campaign.copy) {
      throw new BadRequestException('Campaign has no copy to refine.');
    }

    const cost = TOKEN_COSTS.COPY_AND_CAPTION;
    const balance = await this.tokensService.canAffordCampaign(userId, 0);
    if (balance.balance < cost) {
      throw new BadRequestException(
        `Insufficient tokens. You need ${cost} tokens but only have ${balance.balance}.`,
      );
    }

    await this.tokensService.chargeTokens(userId, cost, id, 'Refine copy');

    const client = campaign.clientId as any;
    const refinedCopy = await this.openRouterService.refineCopy(
      campaign.copy,
      dto.instructions,
      {
        socialMedia: campaign.socialMedia,
        clientName: client?.name || '',
        clientDescription: client?.description || '',
        campaignDescription: campaign.campaignDescription,
      },
    );

    return this.campaignsService.update(id, userId, { copy: refinedCopy } as any);
  }

  @Post(':id/refine-caption')
  async refineCaption(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: RefineContentDto,
  ) {
    const campaign = await this.campaignsService.findById(id);
    if (campaign.userId.toString() !== userId) {
      throw new BadRequestException('You do not own this campaign.');
    }
    if (!campaign.caption) {
      throw new BadRequestException('Campaign has no caption to refine.');
    }

    const cost = TOKEN_COSTS.COPY_AND_CAPTION;
    const balance = await this.tokensService.canAffordCampaign(userId, 0);
    if (balance.balance < cost) {
      throw new BadRequestException(
        `Insufficient tokens. You need ${cost} tokens but only have ${balance.balance}.`,
      );
    }

    await this.tokensService.chargeTokens(userId, cost, id, 'Refine caption');

    const client = campaign.clientId as any;
    const refinedCaption = await this.openRouterService.refineCaption(
      campaign.caption,
      dto.instructions,
      {
        socialMedia: campaign.socialMedia,
        clientName: client?.name || '',
        clientDescription: client?.description || '',
        campaignDescription: campaign.campaignDescription,
      },
    );

    return this.campaignsService.update(id, userId, { caption: refinedCaption } as any);
  }

  @Post(':id/generate-images')
  async generateImages(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: GenerateImagesDto,
  ) {
    const campaign = await this.campaignsService.findById(id);
    if (campaign.userId.toString() !== userId) {
      throw new BadRequestException('You do not own this campaign.');
    }

    const currentCount = campaign.generatedImages?.length || 0;
    if (currentCount + dto.count > 10) {
      throw new BadRequestException(
        `Cannot exceed 10 images. You currently have ${currentCount} and requested ${dto.count}.`,
      );
    }

    const cost = dto.count * TOKEN_COSTS.PER_IMAGE;
    const balance = await this.tokensService.canAffordCampaign(userId, 0);
    if (balance.balance < cost) {
      throw new BadRequestException(
        `Insufficient tokens. You need ${cost} tokens but only have ${balance.balance}.`,
      );
    }

    await this.tokensService.chargeTokens(userId, cost, id, `Generate ${dto.count} additional image(s)`);

    const imagePrompt = campaign.imagePrompt || campaign.campaignDescription;
    const newImages: string[] = [];

    const variationStyles = [
      'Focus on the product itself. Highlight product details, features, and quality.',
      'Create a lifestyle scene. Show the product being used in a real-life, aspirational context.',
      'Emphasize brand identity. Create a bold, branded visual that communicates the brand values.',
      'Use a minimalist and clean aesthetic with ample white space.',
      'Create a vibrant, colorful composition that grabs attention on social media.',
      'Show the product in a before-and-after or comparison format.',
      'Create a flat lay or overhead arrangement featuring the product.',
      'Use dramatic lighting and shadows for a premium, luxury feel.',
      'Create an infographic-style image highlighting key features or benefits.',
      'Design a seasonal or trending theme that feels timely and relevant.',
    ];

    const promises = Array.from({ length: dto.count }, (_, i) => {
      const style = dto.instructions || variationStyles[(currentCount + i) % variationStyles.length];
      return this.openRouterService.generateSingleImage(
        imagePrompt,
        style,
        campaign.productImage,
      );
    });

    const results = await Promise.all(promises);
    for (const result of results) {
      if (result) {
        newImages.push(result);
      }
    }

    const updatedImages = [...campaign.generatedImages, ...newImages];
    return this.campaignsService.update(id, userId, { generatedImages: updatedImages } as any);
  }

  @Delete(':id/images/:imageIndex')
  async removeImage(
    @Param('id', ObjectIdValidationPipe) id: string,
    @Param('imageIndex', ParseIntPipe) imageIndex: number,
    @CurrentUser('userId') userId: string,
  ) {
    const campaign = await this.campaignsService.findById(id);
    if (campaign.userId.toString() !== userId) {
      throw new BadRequestException('You do not own this campaign.');
    }

    if (imageIndex < 0 || imageIndex >= campaign.generatedImages.length) {
      throw new BadRequestException('Image index out of bounds.');
    }

    const updatedImages = [...campaign.generatedImages];
    updatedImages.splice(imageIndex, 1);

    let selectedImage = campaign.selectedImage;
    if (selectedImage !== null && selectedImage !== undefined) {
      if (selectedImage === imageIndex) {
        selectedImage = null;
      } else if (selectedImage > imageIndex) {
        selectedImage = selectedImage - 1;
      }
    }

    return this.campaignsService.update(id, userId, {
      generatedImages: updatedImages,
      selectedImage,
    } as any);
  }

  @Post(':id/images/upload')
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required.');
    }

    const campaign = await this.campaignsService.findById(id);
    if (campaign.userId.toString() !== userId) {
      throw new BadRequestException('You do not own this campaign.');
    }

    const currentCount = campaign.generatedImages?.length || 0;
    if (currentCount >= 10) {
      throw new BadRequestException('Cannot exceed 10 images per campaign.');
    }

    const imagePath = await this.uploadService.saveFile(file);
    const updatedImages = [...campaign.generatedImages, imagePath];

    return this.campaignsService.update(id, userId, { generatedImages: updatedImages } as any);
  }

  @Delete(':id')
  delete(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.campaignsService.delete(id, userId);
  }
}
