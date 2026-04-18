import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { PaymentMethodType } from '../../../common/constants';

export type PaymentMethodConfigDocument =
  HydratedDocument<PaymentMethodConfig>;

@Schema({ timestamps: true })
export class PaymentMethodConfig {
  @Prop({ type: String, enum: PaymentMethodType, required: true, unique: true })
  type: string;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  config: Record<string, any>;
}

export const PaymentMethodConfigSchema =
  SchemaFactory.createForClass(PaymentMethodConfig);
