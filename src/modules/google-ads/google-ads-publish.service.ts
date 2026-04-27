import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleAdsService } from './google-ads.service';
import { GoogleAdsConnectionDocument } from './schemas/google-ads-connection.schema';
import { PublishPmaxDto } from './dto/publish-pmax.dto';

// Google's geoTargetConstants and languageConstants map to numeric IDs, not
// ISO codes. These are stable and widely used; the full list lives at
// https://developers.google.com/google-ads/api/reference/data/geotargets.
// We cover the countries/languages our UI advertises — unmapped entries are
// dropped with a warning.
const GEO_TARGET_CONSTANTS: Record<string, string> = {
  US: '2840',
  CA: '2124',
  GB: '2826',
  AU: '2036',
  NZ: '2554',
  DE: '2276',
  FR: '2250',
  ES: '2724',
  IT: '2380',
  PT: '2620',
  NL: '2528',
  IE: '2372',
  SE: '2752',
  NO: '2578',
  DK: '2208',
  FI: '2246',
  MX: '2484',
  BR: '2076',
  AR: '2032',
  CL: '2152',
  CO: '2170',
  PE: '2604',
  VE: '2862',
  IN: '2356',
  JP: '2392',
  KR: '2410',
  SG: '2702',
  HK: '2344',
  AE: '2784',
  ZA: '2710',
};

const LANGUAGE_CONSTANTS: Record<string, string> = {
  en: '1000',
  de: '1001',
  fr: '1002',
  es: '1003',
  it: '1004',
  ja: '1005',
  nl: '1010',
  pt: '1014',
};

interface CampaignSnapshot {
  _id: string;
  title: string;
  campaignDescription: string;
  headlines: string[];
  longHeadlines: string[];
  descriptions: string[];
  businessName: string | null;
  generatedImages: string[];
  selectedImage: number | null;
  landscapeImages: string[];
  selectedLandscapeImage: number | null;
  socialMediaLink: string | null;
  googleAdsSuggestion: {
    dailyBudget: number;
    biddingStrategy: string;
    targetCpa: number | null;
    targetRoas: number | null;
    audienceSignals: {
      demographics: { ageRanges: string[]; genders: string[] };
      interests: string[];
      customSegmentHints: string[];
    };
    geo: { countries: string[]; regions: string[] };
    languages: string[];
    finalUrls: string[];
    callToAction: string | null;
  } | null;
}

interface ClientSnapshot {
  name: string;
  logo: string | null;
}

@Injectable()
export class GoogleAdsPublishService {
  private readonly logger = new Logger(GoogleAdsPublishService.name);

  constructor(private readonly googleAdsService: GoogleAdsService) {}

  /**
   * Publishes a google_pmax campaign end-to-end as a single atomic mutate
   * batch (Google rolls back the whole thing if any operation fails). Returns
   * the Google Ads resource IDs for the campaign, asset group, and budget.
   */
  async publishPmaxCampaign(
    connection: GoogleAdsConnectionDocument,
    client: ClientSnapshot,
    campaign: CampaignSnapshot,
    dto: PublishPmaxDto,
  ): Promise<{
    googleCustomerId: string;
    googleAdsCampaignId: string;
    googleAssetGroupId: string;
    googleAdsStatus: string;
  }> {
    if (!connection.customerId) {
      throw new BadRequestException(
        'Google Ads connection is not fully set up (no customer selected).',
      );
    }
    if (!campaign.headlines || campaign.headlines.length < 3) {
      throw new BadRequestException(
        'Google Performance Max requires at least 3 headlines. Regenerate the campaign first.',
      );
    }
    if (!campaign.descriptions || campaign.descriptions.length < 2) {
      throw new BadRequestException(
        'Google Performance Max requires at least 2 descriptions. Regenerate the campaign first.',
      );
    }
    if (campaign.generatedImages.length === 0) {
      throw new BadRequestException(
        'Google Performance Max requires at least 1 square image.',
      );
    }
    if (campaign.landscapeImages.length === 0) {
      throw new BadRequestException(
        'Google Performance Max requires at least 1 landscape (1.91:1) image.',
      );
    }
    if (!client.logo) {
      throw new BadRequestException(
        'Brand logo is required for Google Performance Max. Upload a logo on the brand before publishing.',
      );
    }

    const suggestion = campaign.googleAdsSuggestion;
    const cid = connection.customerId;

    // Resolve effective values: DTO overrides > suggestion > sensible defaults.
    const name = (dto.name || campaign.title || 'ContenidIA PMax').slice(0, 255);
    const dailyBudget = dto.dailyBudget ?? suggestion?.dailyBudget ?? 20;
    const biddingStrategy =
      dto.biddingStrategy ?? suggestion?.biddingStrategy ?? 'MAXIMIZE_CONVERSIONS';
    const targetCpa = dto.targetCpa ?? suggestion?.targetCpa ?? null;
    const targetRoas = dto.targetRoas ?? suggestion?.targetRoas ?? null;
    const countries = dto.countries ?? suggestion?.geo.countries ?? ['US'];
    const languages = dto.languages ?? suggestion?.languages ?? ['en'];
    const finalUrls =
      (dto.finalUrls ?? suggestion?.finalUrls ?? []).filter(
        (u) => typeof u === 'string' && u.startsWith('http'),
      );
    if (finalUrls.length === 0 && campaign.socialMediaLink) {
      finalUrls.push(campaign.socialMediaLink);
    }
    if (finalUrls.length === 0) {
      throw new BadRequestException(
        'At least one final URL is required. Set the landing URL on the campaign or include it in the publish payload.',
      );
    }
    const callToAction = dto.callToAction ?? suggestion?.callToAction ?? null;
    const customSegmentHints = (suggestion?.audienceSignals.customSegmentHints ?? []).slice(0, 4);

    const accessToken = await this.googleAdsService.getFreshAccessToken(connection);

    // Temp resource names used inside this mutate batch. Google resolves them
    // in order — anything referenced later in the batch must be declared first.
    const budgetRN = `customers/${cid}/campaignBudgets/-1`;
    const campaignRN = `customers/${cid}/campaigns/-2`;
    const assetGroupRN = `customers/${cid}/assetGroups/-3`;

    const operations: any[] = [];

    // --- 1. Campaign budget ---
    operations.push({
      campaignBudgetOperation: {
        create: {
          resourceName: budgetRN,
          name: `${name} Budget ${Date.now()}`,
          amountMicros: String(Math.round(dailyBudget * 1_000_000)),
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      },
    });

    // --- 2. Campaign ---
    const campaignCreate: Record<string, any> = {
      resourceName: campaignRN,
      name,
      advertisingChannelType: 'PERFORMANCE_MAX',
      status: 'PAUSED',
      campaignBudget: budgetRN,
    };
    if (biddingStrategy === 'TARGET_CPA' && targetCpa) {
      campaignCreate.targetCpa = {
        targetCpaMicros: String(Math.round(targetCpa * 1_000_000)),
      };
    } else if (biddingStrategy === 'TARGET_ROAS' && targetRoas) {
      campaignCreate.targetRoas = { targetRoas };
    } else if (biddingStrategy === 'MAXIMIZE_CONVERSION_VALUE') {
      campaignCreate.maximizeConversionValue = {};
    } else {
      campaignCreate.maximizeConversions = {};
    }
    if (dto.startDate) campaignCreate.startDate = dto.startDate.replace(/-/g, '');
    if (dto.endDate) campaignCreate.endDate = dto.endDate.replace(/-/g, '');
    operations.push({ campaignOperation: { create: campaignCreate } });

    // --- 3. Asset group ---
    operations.push({
      assetGroupOperation: {
        create: {
          resourceName: assetGroupRN,
          name: `${name} Asset Group`,
          campaign: campaignRN,
          finalUrls,
          status: 'ENABLED',
        },
      },
    });

    // --- 4. Text assets + links ---
    let tempAssetId = -100;
    const addTextAsset = (text: string, fieldType: string) => {
      const rn = `customers/${cid}/assets/${tempAssetId}`;
      tempAssetId -= 1;
      operations.push({
        assetOperation: {
          create: {
            resourceName: rn,
            textAsset: { text },
          },
        },
      });
      operations.push({
        assetGroupAssetOperation: {
          create: {
            assetGroup: assetGroupRN,
            asset: rn,
            fieldType,
          },
        },
      });
    };

    // Cap counts at Google's limits — our AI already caps these, but be defensive.
    campaign.headlines.slice(0, 15).forEach((h) => addTextAsset(h, 'HEADLINE'));
    campaign.longHeadlines.slice(0, 5).forEach((h) => addTextAsset(h, 'LONG_HEADLINE'));
    campaign.descriptions.slice(0, 5).forEach((d) => addTextAsset(d, 'DESCRIPTION'));

    const businessName = (campaign.businessName || client.name).slice(0, 25);
    addTextAsset(businessName, 'BUSINESS_NAME');

    // --- 5. Image assets + links ---
    const addImageAsset = async (
      imagePath: string,
      fieldType: string,
      labelName: string,
    ) => {
      const absolutePath = path.isAbsolute(imagePath)
        ? imagePath
        : path.join(process.cwd(), imagePath);
      if (!fs.existsSync(absolutePath)) {
        this.logger.warn(`Skipping missing image asset: ${absolutePath}`);
        return;
      }
      const data = fs.readFileSync(absolutePath).toString('base64');
      const rn = `customers/${cid}/assets/${tempAssetId}`;
      tempAssetId -= 1;
      operations.push({
        assetOperation: {
          create: {
            resourceName: rn,
            name: labelName,
            type: 'IMAGE',
            imageAsset: { data },
          },
        },
      });
      operations.push({
        assetGroupAssetOperation: {
          create: {
            assetGroup: assetGroupRN,
            asset: rn,
            fieldType,
          },
        },
      });
    };

    // Square image: the selected one for Feed/Explore.
    const squareIdx = campaign.selectedImage ?? 0;
    const squarePath =
      campaign.generatedImages[squareIdx] ?? campaign.generatedImages[0];
    await addImageAsset(squarePath, 'SQUARE_MARKETING_IMAGE', 'Square 1:1');

    // Include remaining squares as extra SQUARE_MARKETING_IMAGE variants so
    // Google's ML has material to rotate (capped at 20 total).
    for (let i = 0; i < campaign.generatedImages.length && i < 20; i++) {
      if (i === squareIdx) continue;
      await addImageAsset(
        campaign.generatedImages[i],
        'SQUARE_MARKETING_IMAGE',
        `Square 1:1 #${i + 1}`,
      );
    }

    // Landscape image(s): the selected one for Feed/YouTube cards.
    const landscapeIdx = campaign.selectedLandscapeImage ?? 0;
    const landscapePath =
      campaign.landscapeImages[landscapeIdx] ?? campaign.landscapeImages[0];
    await addImageAsset(landscapePath, 'MARKETING_IMAGE', 'Landscape 1.91:1');
    for (let i = 0; i < campaign.landscapeImages.length && i < 20; i++) {
      if (i === landscapeIdx) continue;
      await addImageAsset(
        campaign.landscapeImages[i],
        'MARKETING_IMAGE',
        `Landscape 1.91:1 #${i + 1}`,
      );
    }

    // Logo (required). We reuse the brand logo; PMax wants 1:1.
    await addImageAsset(client.logo!, 'LOGO', 'Brand Logo');

    // --- 6. Call-to-action asset (optional) ---
    if (callToAction) {
      const rn = `customers/${cid}/assets/${tempAssetId}`;
      tempAssetId -= 1;
      operations.push({
        assetOperation: {
          create: {
            resourceName: rn,
            callToActionAsset: { callToAction },
          },
        },
      });
      operations.push({
        assetGroupAssetOperation: {
          create: {
            assetGroup: assetGroupRN,
            asset: rn,
            fieldType: 'CALL_TO_ACTION_SELECTION',
          },
        },
      });
    }

    // --- 7. Geo + language campaign criteria ---
    for (const country of countries) {
      const id = GEO_TARGET_CONSTANTS[country.toUpperCase()];
      if (!id) {
        this.logger.warn(
          `Skipping unsupported geo target country: ${country}. Extend GEO_TARGET_CONSTANTS to cover it.`,
        );
        continue;
      }
      operations.push({
        campaignCriterionOperation: {
          create: {
            campaign: campaignRN,
            location: { geoTargetConstant: `geoTargetConstants/${id}` },
          },
        },
      });
    }
    for (const language of languages) {
      const id = LANGUAGE_CONSTANTS[language.toLowerCase()];
      if (!id) {
        this.logger.warn(
          `Skipping unsupported language: ${language}. Extend LANGUAGE_CONSTANTS to cover it.`,
        );
        continue;
      }
      operations.push({
        campaignCriterionOperation: {
          create: {
            campaign: campaignRN,
            language: { languageConstant: `languageConstants/${id}` },
          },
        },
      });
    }

    // --- 8. Asset group signals (search themes from customSegmentHints) ---
    for (const hint of customSegmentHints) {
      operations.push({
        assetGroupSignalOperation: {
          create: {
            assetGroup: assetGroupRN,
            searchTheme: { text: hint.slice(0, 200) },
          },
        },
      });
    }

    this.logger.log(
      `Submitting PMax mutate batch: ${operations.length} operations to customer ${cid}`,
    );

    const results = await this.googleAdsService.mutate(
      accessToken,
      cid,
      operations,
      connection.loginCustomerId,
    );

    // Pick out the resource names we care about. Order matches the operation
    // order we pushed: budget[0], campaign[1], assetGroup[2].
    const budgetResource =
      results[0]?.campaignBudgetResult?.resourceName ??
      results[0]?.campaign_budget_result?.resourceName ??
      '';
    const campaignResource =
      results[1]?.campaignResult?.resourceName ??
      results[1]?.campaign_result?.resourceName ??
      '';
    const assetGroupResource =
      results[2]?.assetGroupResult?.resourceName ??
      results[2]?.asset_group_result?.resourceName ??
      '';

    if (!campaignResource || !assetGroupResource) {
      throw new BadRequestException(
        'Google Ads did not return expected campaign/assetGroup resource names after publish.',
      );
    }

    // Extract numeric IDs from resource names: "customers/X/campaigns/Y"
    const campaignId = campaignResource.split('/').pop() || '';
    const assetGroupId = assetGroupResource.split('/').pop() || '';

    this.logger.log(
      `PMax campaign published: campaignId=${campaignId}, assetGroupId=${assetGroupId}`,
    );

    return {
      googleCustomerId: cid,
      googleAdsCampaignId: campaignId,
      googleAssetGroupId: assetGroupId,
      googleAdsStatus: 'PAUSED',
    };
  }
}
