import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClaudeService } from './claude.service';
import { GeminiService } from './gemini.service';
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CampaignStatus, SocialMedia } from '../../common/constants';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly claudeService: ClaudeService,
    private readonly geminiService: GeminiService,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async generateCampaignContent(campaignId: string): Promise<void> {
    let campaign: CampaignDocument | null = null;

    try {
      // 1. Update campaign status to GENERATING
      campaign = await this.campaignModel
        .findByIdAndUpdate(
          campaignId,
          { status: CampaignStatus.GENERATING },
          { new: true },
        )
        .exec();

      if (!campaign) {
        throw new Error('Campaign not found.');
      }

      // 2. Fetch client and user data
      const client = await this.clientModel
        .findById(campaign.clientId)
        .exec();
      if (!client) {
        throw new Error('Client not found.');
      }

      const user = await this.userModel.findById(campaign.userId).exec();
      const language = user?.language || 'en';

      // 3. Get top performing campaigns for retroactive learning
      const topPerformers = await this.campaignModel
        .find({
          userId: campaign.userId,
          performanceScore: { $ne: null },
          socialMedia: campaign.socialMedia,
        })
        .sort({ performanceScore: -1 })
        .limit(5)
        .exec();

      const topPerformersData = topPerformers.map((p) => ({
        copy: p.copy,
        caption: p.caption,
        performanceScore: p.performanceScore,
        socialMedia: p.socialMedia,
      }));

      // 4. Generate copy with Claude
      this.logger.log(`Generating copy for campaign ${campaignId}`);
      const copy = await this.claudeService.generateCopy({
        socialMedia: campaign.socialMedia,
        campaignDescription: campaign.campaignDescription,
        clientName: client.name,
        clientDescription: client.description,
        language,
        topPerformers: topPerformersData,
      });

      // Save partial result
      await this.campaignModel
        .findByIdAndUpdate(campaignId, { copy })
        .exec();

      // 5. Generate caption with Claude
      this.logger.log(`Generating caption for campaign ${campaignId}`);
      const caption = await this.claudeService.generateCaption({
        socialMedia: campaign.socialMedia,
        campaignDescription: campaign.campaignDescription,
        clientName: client.name,
        clientDescription: client.description,
        language,
        copy,
        topPerformers: topPerformersData,
      });

      // Save partial result
      await this.campaignModel
        .findByIdAndUpdate(campaignId, { caption })
        .exec();

      // 6. Generate image prompt with Claude
      this.logger.log(`Generating image prompt for campaign ${campaignId}`);
      const imagePrompt = await this.claudeService.generateImagePrompt({
        copy,
        caption,
        imageDescription: campaign.imageDescription,
        socialMedia: campaign.socialMedia,
        clientName: client.name,
      });

      // Save partial result
      await this.campaignModel
        .findByIdAndUpdate(campaignId, { imagePrompt })
        .exec();

      // 7. Generate images with Gemini (3 variations in parallel)
      this.logger.log(`Generating images for campaign ${campaignId}`);
      const generatedImages = await this.geminiService.generateImages(
        imagePrompt,
        campaign.productImage,
      );

      // 8. Update campaign with final results
      await this.campaignModel
        .findByIdAndUpdate(campaignId, {
          generatedImages,
          status: CampaignStatus.READY,
        })
        .exec();

      this.logger.log(
        `Campaign ${campaignId} content generated successfully`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to generate content for campaign ${campaignId}: ${error.message}`,
      );

      // Set status to FAILED but keep any partial results
      if (campaign) {
        await this.campaignModel
          .findByIdAndUpdate(campaignId, {
            status: CampaignStatus.FAILED,
          })
          .exec();
      }
    }
  }
}
