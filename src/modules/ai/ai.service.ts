import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OpenRouterService } from './openrouter.service';
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CampaignStatus, TEXT_AGENT_MODELS, IMAGE_AGENT_MODELS } from '../../common/constants';
import { MetaService, MetaCampaignHistoryItem } from '../meta/meta.service';
import { MetaConnectionService } from '../meta/meta-connection.service';
import {
  GoogleAdsService,
  GoogleAdsCampaignHistoryItem,
} from '../google-ads/google-ads.service';
import { GoogleAdsConnectionService } from '../google-ads/google-ads-connection.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly openRouterService: OpenRouterService,
    private readonly metaService: MetaService,
    private readonly metaConnectionService: MetaConnectionService,
    private readonly googleAdsService: GoogleAdsService,
    private readonly googleAdsConnectionService: GoogleAdsConnectionService,
    private readonly configService: ConfigService,
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

      // Resolve model overrides from campaign agent choices. The creative
      // package (copy + caption + imagePrompt) comes from a single call on the
      // textAgent model; imagePromptAgent is no longer used at generation time.
      const textModel = campaign.textAgent ? TEXT_AGENT_MODELS[campaign.textAgent] : undefined;
      const imageModel = campaign.imageAgent ? IMAGE_AGENT_MODELS[campaign.imageAgent] : undefined;

      // 3. Get top performing campaigns for retroactive learning. For a
      //    cross-placement Meta campaign, pool past Facebook + Instagram
      //    winners since the creative will run on both.
      const socialMediaFilter =
        campaign.socialMedia === 'meta_full'
          ? { $in: ['facebook', 'instagram', 'meta_full'] }
          : campaign.socialMedia;
      const topPerformers = await this.campaignModel
        .find({
          userId: campaign.userId,
          performanceScore: { $ne: null },
          socialMedia: socialMediaFilter,
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

      const imageCount = campaign.imageCount || 3;
      const isMetaFull = campaign.socialMedia === 'meta_full';
      const isGooglePmax = campaign.socialMedia === 'google_pmax';

      // 4. Platform-specific generation dispatch.
      //    - google_pmax: Google Ads asset-pool prompt (headlines / descriptions
      //      / business name / image prompts / googleAdsSuggestion).
      //    - everything else: unified Meta/social prompt (copy / caption /
      //      imagePrompt / verticalImagePrompt / videoPrompt / suggestion).
      let squareImagePrompt: string;
      let verticalPromptForGen: string | null = null;
      let landscapePromptForGen: string | null = null;

      if (isGooglePmax) {
        // Pull the user's past Google Ads campaigns (last 90 days, ranked by
        // conversions) so the model can ground bidding/budget suggestions in
        // real performance. Best-effort — failure returns []
        const googleAdsHistory = await this.fetchGoogleAdsHistoryForCampaign(
          campaign.userId.toString(),
          campaign.clientId.toString(),
        );

        this.logger.log(
          `Generating Google Ads creative package for campaign ${campaignId}`,
        );
        const googleCreative =
          await this.openRouterService.generateGoogleAdsCreative(
            {
              campaignDescription: campaign.campaignDescription,
              clientName: client.name,
              clientDescription: client.description,
              language,
              imageDescription: campaign.imageDescription,
              preserveProduct: campaign.preserveProduct,
              landingUrl: campaign.socialMediaLink || undefined,
              topPerformers: topPerformersData,
              googleAdsHistory,
            },
            textModel,
          );

        await this.campaignModel
          .findByIdAndUpdate(campaignId, {
            headlines: googleCreative.headlines,
            longHeadlines: googleCreative.longHeadlines,
            descriptions: googleCreative.descriptions,
            businessName: googleCreative.businessName,
            imagePrompt: googleCreative.imagePrompt,
            landscapeImagePrompt: googleCreative.landscapeImagePrompt,
            googleAdsSuggestion: googleCreative.suggestion,
          })
          .exec();

        squareImagePrompt = googleCreative.imagePrompt;
        if (googleCreative.landscapeImagePrompt) {
          landscapePromptForGen = googleCreative.landscapeImagePrompt;
        }
      } else {
        // Pull the user's past Meta campaigns on this client's ad account so
        // the AI can ground budget/targeting suggestions in real performance.
        // Fully best-effort: any failure returns an empty list and the model
        // falls back to defaults.
        const metaHistory = await this.fetchMetaHistoryForCampaign(
          campaign.userId.toString(),
          campaign.clientId.toString(),
        );

        this.logger.log(`Generating creative package for campaign ${campaignId}`);
        const creative = await this.openRouterService.generateCreative(
          {
            socialMedia: campaign.socialMedia,
            campaignDescription: campaign.campaignDescription,
            clientName: client.name,
            clientDescription: client.description,
            language,
            imageDescription: campaign.imageDescription,
            preserveProduct: campaign.preserveProduct,
            topPerformers: topPerformersData,
            metaHistory,
          },
          textModel,
        );

        await this.campaignModel
          .findByIdAndUpdate(campaignId, {
            copy: creative.copy,
            caption: creative.caption,
            imagePrompt: creative.imagePrompt,
            verticalImagePrompt: creative.verticalImagePrompt || null,
            videoPrompt: creative.videoPrompt || null,
            suggestion: creative.suggestion,
          })
          .exec();

        squareImagePrompt = creative.imagePrompt;
        if (isMetaFull && creative.verticalImagePrompt) {
          verticalPromptForGen = creative.verticalImagePrompt;
        }
      }

      // 5. Generate images in parallel:
      //    - square 1:1 (always)
      //    - vertical 9:16 (meta_full only, for Stories/Reels)
      //    - landscape 1.91:1 (google_pmax only, for Feed/Maps/YouTube cards)
      const extraLabels: string[] = [];
      if (verticalPromptForGen) extraLabels.push(imageCount + ' vertical');
      if (landscapePromptForGen) extraLabels.push(imageCount + ' landscape');
      this.logger.log(
        `Generating ${imageCount} square${extraLabels.length ? ' + ' + extraLabels.join(' + ') : ''} images for campaign ${campaignId}`,
      );

      const [generatedImages, verticalImages, landscapeImages] = await Promise.all([
        this.openRouterService.generateImages(
          squareImagePrompt,
          campaign.productImages,
          imageCount,
          imageModel,
        ),
        verticalPromptForGen
          ? this.openRouterService.generateImages(
              verticalPromptForGen,
              campaign.productImages,
              imageCount,
              imageModel,
            )
          : Promise.resolve([] as string[]),
        landscapePromptForGen
          ? this.openRouterService.generateImages(
              landscapePromptForGen,
              campaign.productImages,
              imageCount,
              imageModel,
            )
          : Promise.resolve([] as string[]),
      ]);

      // 7. Update campaign with final results
      await this.campaignModel
        .findByIdAndUpdate(campaignId, {
          generatedImages,
          verticalImages,
          selectedVerticalImage: verticalImages.length > 0 ? 0 : null,
          landscapeImages,
          selectedLandscapeImage: landscapeImages.length > 0 ? 0 : null,
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

      if (campaign) {
        await this.campaignModel
          .findByIdAndUpdate(campaignId, {
            status: CampaignStatus.FAILED,
          })
          .exec();
      }
    }
  }

  private async fetchGoogleAdsHistoryForCampaign(
    userId: string,
    clientId: string,
  ): Promise<GoogleAdsCampaignHistoryItem[]> {
    try {
      const connection =
        await this.googleAdsConnectionService.findByUserAndClientOrNull(
          userId,
          clientId,
        );
      if (!connection || !connection.isActive || !connection.customerId) {
        return [];
      }
      const accessToken =
        await this.googleAdsService.getFreshAccessToken(connection);
      const history = await this.googleAdsService.fetchCampaignHistory(
        accessToken,
        connection.customerId,
        connection.loginCustomerId,
      );
      this.logger.log(
        `Pulled ${history.length} past Google Ads campaigns for AI context (client ${clientId})`,
      );
      return history;
    } catch (error: any) {
      this.logger.debug(
        `No Google Ads history available for client ${clientId}: ${error.message}`,
      );
      return [];
    }
  }

  private async fetchMetaHistoryForCampaign(
    userId: string,
    clientId: string,
  ): Promise<MetaCampaignHistoryItem[]> {
    const enabled = this.configService.get<string>(
      'META_HISTORY_SUGGESTIONS_ENABLED',
      'true',
    );
    if (enabled === 'false') return [];

    try {
      const connection = await this.metaConnectionService.findByUserAndClient(
        userId,
        clientId,
      );
      const history = await this.metaService.fetchCampaignHistory(
        connection.adAccountId,
        connection.accessToken,
      );
      this.logger.log(
        `Pulled ${history.length} past Meta campaigns for AI context (client ${clientId})`,
      );
      return history;
    } catch (error) {
      // NotFoundException from findByUserAndClient is the common case: client
      // has no Meta connection yet. Silent fallback is the right behavior.
      this.logger.debug(
        `No Meta history available for client ${clientId}: ${error.message}`,
      );
      return [];
    }
  }
}
