import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import FormData = require('form-data');
import * as fs from 'fs';

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);
  private readonly baseUrl = 'https://graph.facebook.com/v25.0';

  async verifyConnection(
    accessToken: string,
    adAccountId: string,
  ): Promise<{ valid: boolean; accountName: string }> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${adAccountId}`,
        {
          params: {
            fields: 'name,account_status',
            access_token: accessToken,
          },
        },
      );

      return {
        valid: response.data.account_status === 1,
        accountName: response.data.name,
      };
    } catch (error) {
      this.logger.error(
        `Failed to verify Meta connection: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to verify Meta connection: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  async uploadImage(
    adAccountId: string,
    accessToken: string,
    imagePath: string,
  ): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('filename', fs.createReadStream(imagePath));
      formData.append('access_token', accessToken);

      const response = await axios.post(
        `${this.baseUrl}/${adAccountId}/adimages`,
        formData,
        {
          headers: formData.getHeaders(),
        },
      );

      const images = response.data.images;
      const imageHash = Object.values(images)[0] as any;
      return imageHash.hash;
    } catch (error) {
      this.logger.error(
        `Failed to upload image to Meta: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to upload image to Meta: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  async createCampaign(
    adAccountId: string,
    accessToken: string,
    name: string,
    objective: string,
    status = 'PAUSED',
  ): Promise<string> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/${adAccountId}/campaigns`,
        {
          name,
          objective,
          status,
          special_ad_categories: [],
          access_token: accessToken,
        },
      );

      return response.data.id;
    } catch (error) {
      this.logger.error(
        `Failed to create Meta campaign: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to create Meta campaign: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  async createAdSet(
    adAccountId: string,
    accessToken: string,
    campaignId: string,
    name: string,
    dailyBudget: number,
    targeting: Record<string, any>,
    startDate?: string,
    endDate?: string,
  ): Promise<string> {
    try {
      const data: Record<string, any> = {
        campaign_id: campaignId,
        name,
        daily_budget: dailyBudget,
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'REACH',
        targeting,
        status: 'PAUSED',
        access_token: accessToken,
      };

      if (startDate) {
        data.start_time = startDate;
      }
      if (endDate) {
        data.end_time = endDate;
      }

      const response = await axios.post(
        `${this.baseUrl}/${adAccountId}/adsets`,
        data,
      );

      return response.data.id;
    } catch (error) {
      this.logger.error(
        `Failed to create Meta ad set: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to create Meta ad set: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  async createAdCreative(
    adAccountId: string,
    accessToken: string,
    pageId: string,
    imageHash: string,
    message: string,
    linkUrl: string,
    instagramAccountId?: string,
  ): Promise<string> {
    try {
      const objectStorySpec: Record<string, any> = {
        page_id: pageId,
        link_data: {
          image_hash: imageHash,
          message,
          link: linkUrl,
        },
      };

      if (instagramAccountId) {
        objectStorySpec.instagram_actor_id = instagramAccountId;
      }

      const response = await axios.post(
        `${this.baseUrl}/${adAccountId}/adcreatives`,
        {
          name: `Creative - ${message.substring(0, 30)}`,
          object_story_spec: objectStorySpec,
          access_token: accessToken,
        },
      );

      return response.data.id;
    } catch (error) {
      this.logger.error(
        `Failed to create Meta ad creative: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to create Meta ad creative: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  async createAd(
    adAccountId: string,
    accessToken: string,
    adSetId: string,
    creativeId: string,
    name: string,
    status = 'PAUSED',
  ): Promise<string> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/${adAccountId}/ads`,
        {
          adset_id: adSetId,
          creative: { creative_id: creativeId },
          name,
          status,
          access_token: accessToken,
        },
      );

      return response.data.id;
    } catch (error) {
      this.logger.error(
        `Failed to create Meta ad: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to create Meta ad: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  async getCampaignInsights(
    campaignId: string,
    accessToken: string,
  ): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${campaignId}/insights`,
        {
          params: {
            fields: 'impressions,clicks,spend,reach,ctr,actions',
            access_token: accessToken,
          },
        },
      );

      return response.data.data;
    } catch (error) {
      this.logger.error(
        `Failed to get Meta campaign insights: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to get Meta campaign insights: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  async publishFullCampaign(
    connectionData: {
      adAccountId: string;
      accessToken: string;
      pageId: string;
      instagramAccountId?: string;
    },
    campaign: {
      copy: string;
      socialMediaLink: string;
      generatedImages: string[];
      selectedImage: number;
    },
    publishDto: {
      name: string;
      objective?: string;
      dailyBudget?: number;
      targetCountries?: string[];
      startDate?: string;
      endDate?: string;
    },
  ): Promise<{
    metaCampaignId: string;
    metaAdSetId: string;
    metaCreativeId: string;
    metaAdId: string;
  }> {
    const { adAccountId, accessToken, pageId, instagramAccountId } =
      connectionData;
    const objective = publishDto.objective || 'OUTCOME_ENGAGEMENT';
    const dailyBudget = publishDto.dailyBudget || 1000;
    const targetCountries = publishDto.targetCountries || ['US'];

    // Step 1: Upload image
    const imageIndex = campaign.selectedImage ?? 0;
    const imagePath = campaign.generatedImages[imageIndex];
    const imageHash = await this.uploadImage(
      adAccountId,
      accessToken,
      imagePath,
    );
    this.logger.log(`Image uploaded with hash: ${imageHash}`);

    // Step 2: Create campaign
    const metaCampaignId = await this.createCampaign(
      adAccountId,
      accessToken,
      publishDto.name,
      objective,
    );
    this.logger.log(`Campaign created with ID: ${metaCampaignId}`);

    // Step 3: Create ad set
    const targeting = {
      geo_locations: {
        countries: targetCountries,
      },
    };
    const metaAdSetId = await this.createAdSet(
      adAccountId,
      accessToken,
      metaCampaignId,
      `${publishDto.name} - Ad Set`,
      dailyBudget,
      targeting,
      publishDto.startDate,
      publishDto.endDate,
    );
    this.logger.log(`Ad set created with ID: ${metaAdSetId}`);

    // Step 4: Create ad creative
    const metaCreativeId = await this.createAdCreative(
      adAccountId,
      accessToken,
      pageId,
      imageHash,
      campaign.copy || '',
      campaign.socialMediaLink || '',
      instagramAccountId || undefined,
    );
    this.logger.log(`Ad creative created with ID: ${metaCreativeId}`);

    // Step 5: Create ad
    const metaAdId = await this.createAd(
      adAccountId,
      accessToken,
      metaAdSetId,
      metaCreativeId,
      `${publishDto.name} - Ad`,
    );
    this.logger.log(`Ad created with ID: ${metaAdId}`);

    return {
      metaCampaignId,
      metaAdSetId,
      metaCreativeId,
      metaAdId,
    };
  }
}
