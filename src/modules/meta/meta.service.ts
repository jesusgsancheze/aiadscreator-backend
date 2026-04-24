import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import FormData = require('form-data');
import * as fs from 'fs';

export interface MetaCampaignHistoryItem {
  name: string;
  objective?: string;
  dailyBudget?: number; // USD, whole units
  adsets: Array<{
    optimizationGoal?: string;
    billingEvent?: string;
    targeting: {
      countries?: string[];
      ageMin?: number;
      ageMax?: number;
      genders?: number[];
      advantageAudience?: boolean;
    };
  }>;
  insights?: {
    impressions: number;
    clicks: number;
    spend: number; // USD
    ctr: number; // percentage (e.g. 1.23 = 1.23%)
    cpc: number;
    actions: number;
  };
}

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);
  private readonly baseUrl = 'https://graph.facebook.com/v25.0';
  private readonly historyCache = new Map<
    string,
    { timestamp: number; data: MetaCampaignHistoryItem[] }
  >();
  private readonly HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;

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

  /**
   * Uploads a video to Meta's ad account video library via /act_X/advideos.
   * Meta processes videos asynchronously, so after upload we poll the video
   * status for up to ~20s to catch obvious failures early. If processing is
   * still in flight when the timeout hits, we return the ID anyway — Meta
   * will usually finish before the downstream ad creation call runs.
   */
  async uploadVideo(
    adAccountId: string,
    accessToken: string,
    videoPath: string,
  ): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('source', fs.createReadStream(videoPath));
      formData.append('access_token', accessToken);

      const response = await axios.post(
        `${this.baseUrl}/${adAccountId}/advideos`,
        formData,
        {
          headers: formData.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );

      const videoId = response.data?.id;
      if (!videoId) {
        throw new Error('Meta did not return a video ID');
      }

      // Best-effort status polling: up to 10 attempts, 2s apart.
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const statusResp = await axios.get(`${this.baseUrl}/${videoId}`, {
            params: { fields: 'status', access_token: accessToken },
          });
          const videoStatus = statusResp.data?.status?.video_status;
          if (videoStatus === 'ready') {
            this.logger.log(`Video ${videoId} ready after ${attempt + 1} polls`);
            return videoId;
          }
          if (videoStatus === 'error') {
            throw new BadRequestException(
              `Meta rejected the video during processing: ${JSON.stringify(statusResp.data?.status)}`,
            );
          }
        } catch (pollError) {
          if (pollError instanceof BadRequestException) throw pollError;
          // Transient poll errors are non-fatal; keep trying.
        }
      }

      this.logger.warn(
        `Video ${videoId} still processing after poll timeout — proceeding anyway`,
      );
      return videoId;
    } catch (error) {
      this.logger.error(
        `Failed to upload video to Meta: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to upload video to Meta: ${error.response?.data?.error?.message || error.message}`,
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
    optimizationGoal: string = 'REACH',
    billingEvent: string = 'IMPRESSIONS',
  ): Promise<string> {
    try {
      const data: Record<string, any> = {
        campaign_id: campaignId,
        name,
        daily_budget: dailyBudget,
        billing_event: billingEvent,
        optimization_goal: optimizationGoal,
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

  /**
   * Creates a dynamic ad creative with per-placement image customization via
   * asset_feed_spec. The square hash serves Feed/Marketplace/Explore surfaces;
   * the vertical hash serves Stories and Reels. Meta auto-picks which asset
   * to show for each placement based on the asset_customization_rules.
   *
   * This is the Tier 2 publish path, used only for meta_full campaigns that
   * have both a square and a vertical image generated.
   */
  async createDynamicAdCreative(
    adAccountId: string,
    accessToken: string,
    pageId: string,
    squareImageHash: string,
    verticalImageHash: string | null,
    verticalVideoId: string | null,
    message: string,
    linkUrl: string,
    squareRule: {
      publisher_platforms?: string[];
      facebook_positions?: string[];
      instagram_positions?: string[];
    },
    verticalRule: {
      publisher_platforms?: string[];
      facebook_positions?: string[];
      instagram_positions?: string[];
    },
    instagramAccountId?: string,
  ): Promise<string> {
    try {
      const objectStorySpec: Record<string, any> = { page_id: pageId };
      if (instagramAccountId) {
        objectStorySpec.instagram_actor_id = instagramAccountId;
      }

      // Build the asset_feed_spec. The vertical rule routes to either a
      // video (preferred when present) or a vertical image (Tier 2 fallback).
      const useVideo = !!verticalVideoId;
      const images: any[] = [
        { hash: squareImageHash, adlabels: [{ name: 'square' }] },
      ];
      const videos: any[] = [];
      if (useVideo) {
        videos.push({
          video_id: verticalVideoId,
          adlabels: [{ name: 'vertical' }],
        });
      } else if (verticalImageHash) {
        images.push({
          hash: verticalImageHash,
          adlabels: [{ name: 'vertical' }],
        });
      }

      const assetFeedSpec: Record<string, any> = {
        ad_formats: useVideo
          ? ['SINGLE_IMAGE', 'SINGLE_VIDEO']
          : ['SINGLE_IMAGE'],
        images,
        bodies: [{ text: message }],
        link_urls: [{ website_url: linkUrl }],
        call_to_action_types: ['LEARN_MORE'],
        asset_customization_rules: [
          {
            customization_spec: squareRule,
            image_label: { name: 'square' },
          },
          useVideo
            ? {
                customization_spec: verticalRule,
                video_label: { name: 'vertical' },
              }
            : {
                customization_spec: verticalRule,
                image_label: { name: 'vertical' },
              },
        ],
      };
      if (videos.length > 0) {
        assetFeedSpec.videos = videos;
      }

      const response = await axios.post(
        `${this.baseUrl}/${adAccountId}/adcreatives`,
        {
          name: `Dynamic Creative - ${message.substring(0, 30)}`,
          object_story_spec: objectStorySpec,
          asset_feed_spec: assetFeedSpec,
          access_token: accessToken,
        },
      );

      return response.data.id;
    } catch (error) {
      this.logger.error(
        `Failed to create Meta dynamic ad creative: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to create Meta dynamic ad creative: ${error.response?.data?.error?.message || error.message}`,
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
      verticalImages?: string[];
      selectedVerticalImage?: number | null;
      videos?: string[];
      selectedVideo?: number | null;
    },
    publishDto: {
      name: string;
      objective?: string;
      dailyBudget?: number;
      targetCountries?: string[];
      startDate?: string;
      endDate?: string;
      optimizationGoal?: string;
      billingEvent?: string;
      ageMin?: number;
      ageMax?: number;
      genders?: number[];
      advantageAudience?: boolean;
      interests?: string[];
      publisherPlatforms?: string[];
      facebookPositions?: string[];
      instagramPositions?: string[];
      messengerPositions?: string[];
      audienceNetworkPositions?: string[];
      useAdvantagePlacements?: boolean;
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
    const optimizationGoal = publishDto.optimizationGoal || 'REACH';
    const billingEvent = publishDto.billingEvent || 'IMPRESSIONS';
    const ageMin = publishDto.ageMin ?? 18;
    const ageMax = publishDto.ageMax ?? 65;
    const requestedInterests = publishDto.interests || [];

    // Step 1: Upload image(s). For meta_full with a vertical companion image
    // we upload both and use a dynamic asset_feed_spec creative so Meta can
    // serve the right aspect per placement.
    const imageIndex = campaign.selectedImage ?? 0;
    const imagePath = campaign.generatedImages[imageIndex];
    const imageHash = await this.uploadImage(
      adAccountId,
      accessToken,
      imagePath,
    );
    this.logger.log(`Square image uploaded with hash: ${imageHash}`);

    const hasVertical =
      !!campaign.verticalImages && campaign.verticalImages.length > 0;
    let verticalImageHash: string | null = null;
    if (hasVertical) {
      const verticalIndex = campaign.selectedVerticalImage ?? 0;
      const verticalPath = campaign.verticalImages![verticalIndex] ?? campaign.verticalImages![0];
      verticalImageHash = await this.uploadImage(
        adAccountId,
        accessToken,
        verticalPath,
      );
      this.logger.log(`Vertical image uploaded with hash: ${verticalImageHash}`);
    }

    // Video takes precedence over the vertical image for Stories/Reels when
    // the user has attached one.
    const hasVideo = !!campaign.videos && campaign.videos.length > 0;
    let verticalVideoId: string | null = null;
    if (hasVideo) {
      const videoIndex = campaign.selectedVideo ?? 0;
      const videoPath =
        campaign.videos![videoIndex] ?? campaign.videos![0];
      verticalVideoId = await this.uploadVideo(
        adAccountId,
        accessToken,
        videoPath,
      );
      this.logger.log(`Vertical video uploaded with ID: ${verticalVideoId}`);
    }

    // Step 2: Create campaign
    const metaCampaignId = await this.createCampaign(
      adAccountId,
      accessToken,
      publishDto.name,
      objective,
    );
    this.logger.log(`Campaign created with ID: ${metaCampaignId}`);

    // Step 3: Resolve AI-suggested interest names → Meta interest IDs.
    // Unresolvable names are dropped silently. If the whole list becomes
    // empty (all hallucinations or API failed) we publish without interests
    // rather than block the user.
    const resolvedInterests = await this.resolveInterests(
      accessToken,
      requestedInterests,
    );
    if (requestedInterests.length > 0) {
      this.logger.log(
        `Resolved ${resolvedInterests.length}/${requestedInterests.length} interest names to Meta IDs`,
      );
    }

    // Step 4: Build the targeting spec
    const targeting: Record<string, any> = {
      geo_locations: { countries: targetCountries },
      age_min: ageMin,
      age_max: ageMax,
    };
    if (publishDto.genders && publishDto.genders.length > 0) {
      targeting.genders = publishDto.genders;
    }
    if (resolvedInterests.length > 0) {
      targeting.flexible_spec = [{ interests: resolvedInterests }];
    }
    if (publishDto.advantageAudience !== undefined) {
      // Meta's Advantage+ Audience flag — 1 enables AI-driven audience expansion.
      targeting.targeting_automation = {
        advantage_audience: publishDto.advantageAudience ? 1 : 0,
      };
    }

    // Placements (meta_full multi-placement campaigns). When
    // useAdvantagePlacements is true, we omit publisher_platforms entirely so
    // Meta's Advantage+ Placements auto-distributes across everything the ad
    // account supports. Otherwise we set the explicit subset.
    const placementPlatforms = publishDto.publisherPlatforms || [];
    if (placementPlatforms.length > 0 && !publishDto.useAdvantagePlacements) {
      targeting.publisher_platforms = placementPlatforms;
      if (
        placementPlatforms.includes('facebook') &&
        publishDto.facebookPositions?.length
      ) {
        targeting.facebook_positions = publishDto.facebookPositions;
      }
      if (
        placementPlatforms.includes('instagram') &&
        publishDto.instagramPositions?.length
      ) {
        targeting.instagram_positions = publishDto.instagramPositions;
      }
      if (
        placementPlatforms.includes('messenger') &&
        publishDto.messengerPositions?.length
      ) {
        targeting.messenger_positions = publishDto.messengerPositions;
      }
      if (
        placementPlatforms.includes('audience_network') &&
        publishDto.audienceNetworkPositions?.length
      ) {
        targeting.device_platforms = ['mobile'];
        targeting.audience_network_positions = publishDto.audienceNetworkPositions;
      }
    }

    // Step 5: Delivery estimate — non-blocking sanity check. If reach is
    // very low, log a warning so the reason is visible when users complain
    // a published campaign never delivered. We don't auto-modify the spec
    // here; the user already approved this targeting in the UI.
    const estimate = await this.estimateDelivery(
      adAccountId,
      accessToken,
      targeting,
      optimizationGoal,
    );
    if (estimate) {
      this.logger.log(
        `Delivery estimate: ${estimate.lowerBound.toLocaleString()}–${estimate.upperBound.toLocaleString()} monthly active users`,
      );
      if (estimate.upperBound > 0 && estimate.upperBound < 1000) {
        this.logger.warn(
          `Targeting is very narrow (upper bound ${estimate.upperBound}). Campaign may have trouble exiting the learning phase.`,
        );
      }
    }

    // Step 6: Create ad set
    const metaAdSetId = await this.createAdSet(
      adAccountId,
      accessToken,
      metaCampaignId,
      `${publishDto.name} - Ad Set`,
      dailyBudget,
      targeting,
      publishDto.startDate,
      publishDto.endDate,
      optimizationGoal,
      billingEvent,
    );
    this.logger.log(`Ad set created with ID: ${metaAdSetId}`);

    // Step 7: Create ad creative.
    //   - hasVertical or hasVideo (meta_full Tier 2/3 path): dynamic
    //     asset_feed_spec with square image routed to Feed/Marketplace and
    //     vertical image OR video routed to Stories/Reels. Video takes
    //     precedence when both are present.
    //   - otherwise: classic single-image link_data creative.
    const useDynamicCreative = hasVertical || hasVideo;
    let metaCreativeId: string;
    if (useDynamicCreative && (verticalImageHash || verticalVideoId)) {
      // Split placements between feed-like (square) and story-like (vertical).
      const platforms = publishDto.publisherPlatforms || [
        'facebook',
        'instagram',
      ];
      const squareRule: Record<string, any> = {
        publisher_platforms: platforms,
      };
      const verticalRule: Record<string, any> = {
        publisher_platforms: platforms,
      };
      const fbFeedish = (publishDto.facebookPositions || [
        'feed',
        'marketplace',
        'video_feeds',
        'search',
        'instream_video',
      ]).filter((p) => p !== 'story');
      const fbStorish = (publishDto.facebookPositions || ['story']).filter(
        (p) => p === 'story',
      );
      const igFeedish = (publishDto.instagramPositions || [
        'stream',
        'explore',
        'explore_home',
      ]).filter((p) => !['story', 'reels'].includes(p));
      const igStorish = (publishDto.instagramPositions || [
        'story',
        'reels',
      ]).filter((p) => ['story', 'reels'].includes(p));
      if (platforms.includes('facebook')) {
        if (fbFeedish.length) squareRule.facebook_positions = fbFeedish;
        if (fbStorish.length) verticalRule.facebook_positions = fbStorish;
      }
      if (platforms.includes('instagram')) {
        if (igFeedish.length) squareRule.instagram_positions = igFeedish;
        if (igStorish.length) verticalRule.instagram_positions = igStorish;
      }
      metaCreativeId = await this.createDynamicAdCreative(
        adAccountId,
        accessToken,
        pageId,
        imageHash,
        verticalImageHash,
        verticalVideoId,
        campaign.copy || '',
        campaign.socialMediaLink || '',
        squareRule,
        verticalRule,
        instagramAccountId || undefined,
      );
    } else {
      metaCreativeId = await this.createAdCreative(
        adAccountId,
        accessToken,
        pageId,
        imageHash,
        campaign.copy || '',
        campaign.socialMediaLink || '',
        instagramAccountId || undefined,
      );
    }
    this.logger.log(`Ad creative created with ID: ${metaCreativeId}`);

    // Step 8: Create ad
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

  /**
   * Fetches a ranked, normalized slice of the user's past campaigns for AI
   * grounding. Resilient by design: any partial failure returns what it can
   * (or an empty list), so the caller can always proceed without history.
   */
  async fetchCampaignHistory(
    adAccountId: string,
    accessToken: string,
  ): Promise<MetaCampaignHistoryItem[]> {
    const cached = this.historyCache.get(adAccountId);
    if (cached && Date.now() - cached.timestamp < this.HISTORY_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const campaignsResp = await axios.get(
        `${this.baseUrl}/${adAccountId}/campaigns`,
        {
          params: {
            fields: 'id,name,objective,status,daily_budget',
            limit: 20,
            date_preset: 'last_90d',
            access_token: accessToken,
          },
        },
      );
      const campaigns: any[] = campaignsResp.data?.data || [];

      const enriched = await Promise.all(
        campaigns.map(async (c) => {
          try {
            const [adsetsResp, insightsResp] = await Promise.all([
              axios
                .get(`${this.baseUrl}/${c.id}/adsets`, {
                  params: {
                    fields:
                      'targeting,daily_budget,optimization_goal,billing_event',
                    limit: 5,
                    access_token: accessToken,
                  },
                })
                .catch(() => ({ data: { data: [] } })),
              axios
                .get(`${this.baseUrl}/${c.id}/insights`, {
                  params: {
                    fields: 'impressions,clicks,spend,ctr,cpc,actions',
                    date_preset: 'last_90d',
                    access_token: accessToken,
                  },
                })
                .catch(() => ({ data: { data: [] } })),
            ]);

            const adsets = (adsetsResp.data?.data || []).map((a: any) => ({
              optimizationGoal: a.optimization_goal,
              billingEvent: a.billing_event,
              targeting: this.normalizeTargeting(a.targeting),
            }));

            const insightsRaw = insightsResp.data?.data?.[0];
            const insights = insightsRaw
              ? {
                  impressions: Number(insightsRaw.impressions) || 0,
                  clicks: Number(insightsRaw.clicks) || 0,
                  spend: Number(insightsRaw.spend) || 0,
                  ctr: Number(insightsRaw.ctr) || 0,
                  cpc: Number(insightsRaw.cpc) || 0,
                  actions: Array.isArray(insightsRaw.actions)
                    ? insightsRaw.actions.reduce(
                        (sum: number, a: any) => sum + (Number(a.value) || 0),
                        0,
                      )
                    : 0,
                }
              : undefined;

            const item: MetaCampaignHistoryItem = {
              name: c.name,
              objective: c.objective,
              dailyBudget: c.daily_budget
                ? Number(c.daily_budget) / 100
                : undefined,
              adsets,
              insights,
            };
            return item;
          } catch {
            return null;
          }
        }),
      );

      const withInsights = enriched.filter(
        (e): e is MetaCampaignHistoryItem =>
          e !== null && !!e.insights && e.insights.spend > 0,
      );
      withInsights.sort(
        (a, b) =>
          b.insights!.ctr - a.insights!.ctr ||
          b.insights!.spend - a.insights!.spend,
      );
      const top = withInsights.slice(0, 5);

      this.historyCache.set(adAccountId, { timestamp: Date.now(), data: top });
      this.logger.log(
        `Fetched ${top.length} ranked Meta campaigns for ${adAccountId}`,
      );
      return top;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Meta campaign history for ${adAccountId}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Resolves AI-suggested interest names to real Meta interest IDs via the
   * targeting search API. Unresolvable names (hallucinations, misspellings)
   * are silently dropped. Returns an empty array if the whole lookup fails —
   * callers should treat interests as optional.
   */
  async resolveInterests(
    accessToken: string,
    names: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    if (!names || names.length === 0) return [];

    const results = await Promise.all(
      names.map(async (name) => {
        try {
          const response = await axios.get(`${this.baseUrl}/search`, {
            params: {
              type: 'adinterest',
              q: name,
              limit: 1,
              access_token: accessToken,
            },
          });
          const first = response.data?.data?.[0];
          if (first?.id && first?.name) {
            return { id: String(first.id), name: String(first.name) };
          }
          return null;
        } catch (error) {
          this.logger.debug(
            `Interest lookup failed for "${name}": ${error.message}`,
          );
          return null;
        }
      }),
    );

    // Dedupe by id (different search terms can map to the same interest)
    const seen = new Set<string>();
    const resolved: Array<{ id: string; name: string }> = [];
    for (const r of results) {
      if (r && !seen.has(r.id)) {
        seen.add(r.id);
        resolved.push(r);
      }
    }
    return resolved;
  }

  /**
   * Asks Meta for a delivery estimate (reach lower/upper bound) for a given
   * targeting spec + optimization goal. Returns null on any failure so callers
   * can degrade gracefully.
   */
  async estimateDelivery(
    adAccountId: string,
    accessToken: string,
    targetingSpec: Record<string, any>,
    optimizationGoal: string,
  ): Promise<{ lowerBound: number; upperBound: number } | null> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${adAccountId}/delivery_estimate`,
        {
          params: {
            targeting_spec: JSON.stringify(targetingSpec),
            optimization_goal: optimizationGoal,
            access_token: accessToken,
          },
        },
      );
      const first = response.data?.data?.[0];
      if (!first || first.estimate_ready === false) return null;
      return {
        lowerBound: Number(first.estimate_mau_lower_bound) || 0,
        upperBound: Number(first.estimate_mau_upper_bound) || 0,
      };
    } catch (error) {
      this.logger.debug(
        `Delivery estimate failed for ${adAccountId}: ${error.message}`,
      );
      return null;
    }
  }

  private normalizeTargeting(
    targeting: any,
  ): MetaCampaignHistoryItem['adsets'][number]['targeting'] {
    if (!targeting) return {};
    return {
      countries: targeting.geo_locations?.countries || undefined,
      ageMin: targeting.age_min,
      ageMax: targeting.age_max,
      genders: targeting.genders,
      advantageAudience:
        targeting.targeting_automation?.advantage_audience === 1
          ? true
          : undefined,
    };
  }
}
