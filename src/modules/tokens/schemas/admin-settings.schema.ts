import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AdminSettingsDocument = HydratedDocument<AdminSettings>;

@Schema({ timestamps: true })
export class AdminSettings {
  @Prop({ type: String, required: true, unique: true })
  key: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  value: any;
}

export const AdminSettingsSchema = SchemaFactory.createForClass(AdminSettings);
