import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MetaConnectionDocument = HydratedDocument<MetaConnection>;

@Schema({ timestamps: true })
export class MetaConnection {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true, index: true })
  clientId: Types.ObjectId;

  @Prop({ type: String, required: true })
  accessToken: string;

  @Prop({ type: String, required: true })
  adAccountId: string;

  @Prop({ type: String, required: true })
  pageId: string;

  @Prop({ type: String, default: null })
  instagramAccountId: string | null;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: null })
  lastVerified: Date | null;
}

export const MetaConnectionSchema =
  SchemaFactory.createForClass(MetaConnection);

MetaConnectionSchema.index({ userId: 1, clientId: 1 }, { unique: true });
