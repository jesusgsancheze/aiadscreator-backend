import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MetaConnectionService } from './meta-connection.service';
import { MetaService } from './meta.service';
import { CreateMetaConnectionDto } from './dto/create-meta-connection.dto';
import { UpdateMetaConnectionDto } from './dto/update-meta-connection.dto';
import { PublishCampaignDto } from './dto/publish-campaign.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Campaign, CampaignDocument } from '../campaigns/schemas/campaign.schema';
import { MetaConnection, MetaConnectionDocument } from './schemas/meta-connection.schema';

@Controller('meta')
@UseGuards(JwtAuthGuard)
export class MetaController {
  private readonly logger = new Logger(MetaController.name);

  constructor(
    private readonly metaConnectionService: MetaConnectionService,
    private readonly metaService: MetaService,
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(MetaConnection.name)
    private readonly metaConnectionModel: Model<MetaConnectionDocument>,
  ) {}

  @Post('connections')
  async createConnection(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateMetaConnectionDto,
  ) {
    return this.metaConnectionService.create(userId, dto);
  }

  @Get('connections')
  async listConnections(@CurrentUser('userId') userId: string) {
    return this.metaConnectionService.findAllByUser(userId);
  }

  @Get('connections/:clientId')
  async getConnectionByClient(
    @CurrentUser('userId') userId: string,
    @Param('clientId') clientId: string,
  ) {
    const connection = await this.metaConnectionModel.findOne({
      userId: new Types.ObjectId(userId),
      clientId: new Types.ObjectId(clientId),
      isActive: true,
    });
    return connection || null;
  }

  @Patch('connections/:id')
  async updateConnection(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMetaConnectionDto,
  ) {
    return this.metaConnectionService.update(id, userId, dto);
  }

  @Delete('connections/:id')
  async deleteConnection(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.metaConnectionService.delete(id, userId);
  }

  @Post('connections/:id/verify')
  async verifyConnection(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    const connection = await this.metaConnectionService.findById(id);
    const result = await this.metaService.verifyConnection(
      connection.accessToken,
      connection.adAccountId,
    );
    return result;
  }

  @Post('publish')
  async publishCampaign(
    @CurrentUser('userId') userId: string,
    @Body() dto: PublishCampaignDto,
  ) {
    // Find the campaign
    const campaign = await this.campaignModel.findById(dto.campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    // Find the Meta connection for this user + client
    const connection = await this.metaConnectionService.findByUserAndClient(
      userId,
      campaign.clientId.toString(),
    );

    // Publish the full campaign
    const result = await this.metaService.publishFullCampaign(
      {
        adAccountId: connection.adAccountId,
        accessToken: connection.accessToken,
        pageId: connection.pageId,
        instagramAccountId: connection.instagramAccountId || undefined,
      },
      {
        copy: campaign.copy || '',
        socialMediaLink: campaign.socialMediaLink || '',
        generatedImages: campaign.generatedImages,
        selectedImage: campaign.selectedImage ?? 0,
        verticalImages: campaign.verticalImages,
        selectedVerticalImage: campaign.selectedVerticalImage,
        videos: campaign.videos,
        selectedVideo: campaign.selectedVideo,
      },
      dto,
    );

    // Update the campaign with Meta IDs
    await this.campaignModel.findByIdAndUpdate(dto.campaignId, {
      metaCampaignId: result.metaCampaignId,
      metaAdSetId: result.metaAdSetId,
      metaAdId: result.metaAdId,
      metaStatus: 'PAUSED',
    });

    this.logger.log(
      `Campaign ${dto.campaignId} published to Meta as ${result.metaCampaignId}`,
    );

    return result;
  }

  @Get('insights/:metaCampaignId')
  async getCampaignInsights(
    @CurrentUser('userId') userId: string,
    @Param('metaCampaignId') metaCampaignId: string,
    @Query('clientId') clientId: string,
  ) {
    // Find any active connection for this user to get the access token
    // If clientId is provided, use that specific connection
    let accessToken: string;

    if (clientId) {
      const connection = await this.metaConnectionService.findByUserAndClient(
        userId,
        clientId,
      );
      accessToken = connection.accessToken;
    } else {
      // Find the campaign by metaCampaignId to get the clientId
      const campaign = await this.campaignModel.findOne({ metaCampaignId });
      if (!campaign) {
        throw new Error('Campaign not found');
      }
      const connection = await this.metaConnectionService.findByUserAndClient(
        userId,
        campaign.clientId.toString(),
      );
      accessToken = connection.accessToken;
    }

    return this.metaService.getCampaignInsights(metaCampaignId, accessToken);
  }
}
