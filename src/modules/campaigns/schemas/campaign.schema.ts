import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SocialMedia, CampaignStatus, TextAgent, ImageAgent } from '../../../common/constants';

export type CampaignDocument = HydratedDocument<Campaign>;

@Schema({ timestamps: true })
export class Campaign {
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

  @Prop({ type: [String], default: [] })
  generatedImages: string[];

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

  @Prop({ type: Number, default: null })
  selectedImage: number | null;

  @Prop({ type: String, default: null })
  metaCampaignId: string | null;

  @Prop({ type: String, default: null })
  metaAdSetId: string | null;

  @Prop({ type: String, default: null })
  metaAdId: string | null;

  @Prop({ type: String, default: null })
  metaStatus: string | null;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
