import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SocialMedia, CampaignStatus, TextAgent, ImageAgent } from '../../../common/constants';

export type CampaignDocument = HydratedDocument<Campaign>;

@Schema({ timestamps: true })
export class Campaign {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ type: String, enum: SocialMedia, required: true })
  socialMedia: SocialMedia;

  @Prop({ type: [String], default: [] })
  productImages: string[];

  @Prop({ required: true })
  campaignDescription: string;

  @Prop({ required: true })
  imageDescription: string;

  @Prop({ type: Number, default: 3, min: 1, max: 10 })
  imageCount: number;

  @Prop({ type: String, enum: TextAgent, default: TextAgent.CLAUDE })
  textAgent: TextAgent;

  @Prop({ type: String, enum: TextAgent, default: TextAgent.CLAUDE })
  imagePromptAgent: TextAgent;

  @Prop({ type: String, enum: ImageAgent, default: ImageAgent.GEMINI })
  imageAgent: ImageAgent;

  @Prop({ type: Boolean, default: false })
  preserveProduct: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true, index: true })
  clientId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, default: null })
  copy: string | null;

  @Prop({ type: String, default: null })
  caption: string | null;

  @Prop({ type: String, default: null })
  imagePrompt: string | null;

  @Prop({ type: String, default: null })
  verticalImagePrompt: string | null;

  @Prop({ type: String, default: null })
  videoPrompt: string | null;

  @Prop({ type: [String], default: [] })
  generatedImages: string[];

  @Prop({ type: [String], default: [] })
  verticalImages: string[];

  @Prop({ type: [String], default: [] })
  videos: string[];

  @Prop({ type: String, enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  @Prop({ type: String, default: null })
  socialMediaLink: string | null;

  @Prop({
    type: Object,
    default: null,
  })
  analytics: {
    impressions?: number;
    clicks?: number;
    conversions?: number;
    engagement?: number;
    reach?: number;
    ctr?: number;
    spent?: number;
  } | null;

  @Prop({ type: Number, default: null })
  performanceScore: number | null;

  @Prop({ type: Object, default: null })
  suggestion: {
    objective: string;
    dailyBudget: number;
    optimizationGoal: string;
    billingEvent: string;
    targeting: {
      countries: string[];
      ageMin: number;
      ageMax: number;
      genders: number[];
      advantageAudience: boolean;
      interests: string[];
    };
    placements?: {
      publisherPlatforms: string[];
      facebookPositions: string[];
      instagramPositions: string[];
      messengerPositions: string[];
      audienceNetworkPositions: string[];
      useAdvantagePlacements: boolean;
    };
    rationale: string;
  } | null;

  @Prop({ type: Number, default: null })
  selectedImage: number | null;

  @Prop({ type: Number, default: null })
  selectedVerticalImage: number | null;

  @Prop({ type: Number, default: null })
  selectedVideo: number | null;

  @Prop({ type: String, default: null })
  metaCampaignId: string | null;

  @Prop({ type: String, default: null })
  metaAdSetId: string | null;

  @Prop({ type: String, default: null })
  metaAdId: string | null;

  @Prop({ type: String, default: null })
  metaStatus: string | null;

  // --- Google Ads (Performance Max) fields ---
  // All null/empty unless socialMedia === 'google_pmax'. Asset groups take
  // pools of text + image assets rather than a single creative.
  @Prop({ type: [String], default: [] })
  headlines: string[]; // up to 15, 30 chars each

  @Prop({ type: [String], default: [] })
  longHeadlines: string[]; // up to 5, 90 chars each

  @Prop({ type: [String], default: [] })
  descriptions: string[]; // up to 5, 90 chars each

  @Prop({ type: [String], default: [] })
  landscapeImages: string[]; // 1.91:1 marketing images (1200x628)

  @Prop({ type: Number, default: null })
  selectedLandscapeImage: number | null;

  @Prop({ type: String, default: null })
  landscapeImagePrompt: string | null;

  @Prop({ type: String, default: null })
  businessName: string | null; // shown in Google PMax ads; usually the client name

  @Prop({ type: Object, default: null })
  googleAdsSuggestion: {
    dailyBudget: number;
    biddingStrategy: string;
    targetCpa: number | null;
    targetRoas: number | null;
    audienceSignals: {
      demographics: {
        ageRanges: string[];
        genders: string[];
      };
      interests: string[];
      customSegmentHints: string[];
    };
    geo: {
      countries: string[];
      regions: string[];
    };
    languages: string[];
    finalUrls: string[];
    callToAction: string | null;
    rationale: string;
  } | null;

  @Prop({ type: String, default: null })
  googleCustomerId: string | null;

  @Prop({ type: String, default: null })
  googleAdsCampaignId: string | null;

  @Prop({ type: String, default: null })
  googleAssetGroupId: string | null;

  @Prop({ type: String, default: null })
  googleAdsStatus: string | null; // LEARNING | ENABLED | LIMITED | PAUSED | REMOVED
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
