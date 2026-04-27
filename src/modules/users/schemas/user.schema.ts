import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Role, Language } from '../../../common/constants';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({ required: true })
  password: string;

  @Prop({ type: String, enum: Role, default: Role.USER })
  role: Role;

  @Prop({ type: String, enum: Language, default: Language.EN })
  language: Language;

  @Prop({ type: Number, default: 0 })
  tokenBalance: number;

  @Prop({ default: false })
  isEmailVerified: boolean;

  @Prop({ type: String, default: null })
  emailVerificationToken: string | null;

  @Prop({ type: Date, default: null })
  emailVerificationExpires: Date | null;

  @Prop({ type: String, default: null })
  passwordResetToken: string | null;

  @Prop({ type: Date, default: null })
  passwordResetExpires: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
