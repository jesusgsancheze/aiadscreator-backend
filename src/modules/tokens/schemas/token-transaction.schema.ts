import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TransactionStatus, PaymentMethodType } from '../../../common/constants';

export type TokenTransactionDocument = HydratedDocument<TokenTransaction>;

@Schema({ timestamps: true })
export class TokenTransaction {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['purchase', 'admin_grant', 'campaign_spend', 'refund'],
    required: true,
  })
  type: string;

  @Prop({ type: Number, required: true })
  tokens: number;

  @Prop({ type: Number, default: null })
  amountUsd: number | null;

  @Prop({ type: String, enum: PaymentMethodType, default: null })
  paymentMethod: string | null;

  @Prop({ type: String, default: null })
  paymentReference: string | null;

  @Prop({ type: String, default: null })
  paymentProof: string | null;

  @Prop({
    type: String,
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: string;

  @Prop({ type: String, default: null })
  adminNote: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  @Prop({ type: String, default: null })
  packageId: string | null;

  @Prop({ type: String, default: null })
  campaignId: string | null;
}

export const TokenTransactionSchema =
  SchemaFactory.createForClass(TokenTransaction);
