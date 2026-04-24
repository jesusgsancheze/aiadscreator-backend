import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GoogleAdsConnectionDocument =
  HydratedDocument<GoogleAdsConnection>;

/**
 * Persists a Google Ads OAuth connection for a (user, client) pair.
 *
 * Flow:
 *  1. User consents via Google OAuth → we receive `refresh_token` + short-lived
 *     `access_token`. The connection is created with `customerId: null`.
 *  2. We call `customers:listAccessibleCustomers` to enumerate customer IDs
 *     the user can manage. They appear on `accessibleCustomers`.
 *  3. The user picks one customer ID in the frontend; we persist it on
 *     `customerId` and set `isActive: true`.
 *  4. Before each API call, `GoogleAdsService.getFreshAccessToken` refreshes
 *     the token if `accessTokenExpiresAt` is in the past.
 */
@Schema({ timestamps: true })
export class GoogleAdsConnection {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Client', required: true, index: true })
  clientId: Types.ObjectId;

  // OAuth tokens
  @Prop({ type: String, required: true })
  refreshToken: string;

  @Prop({ type: String, default: null })
  accessToken: string | null;

  @Prop({ type: Date, default: null })
  accessTokenExpiresAt: Date | null;

  // Scope granted at consent time — surfaced back to the user in case they
  // declined some scopes.
  @Prop({ type: [String], default: [] })
  scopes: string[];

  // Google Ads customer metadata
  @Prop({ type: String, default: null })
  customerId: string | null; // digits only, no dashes (e.g. "1234567890")

  @Prop({ type: String, default: null })
  loginCustomerId: string | null; // MCC ID if managing through a manager account

  @Prop({ type: [String], default: [] })
  accessibleCustomers: string[]; // populated at callback time

  // Activation + verification
  @Prop({ type: Boolean, default: false })
  isActive: boolean;

  @Prop({ type: Date, default: null })
  lastVerified: Date | null;

  // Populated once we've queried the customer's conversion actions at least
  // once. Phase 6 (conversion-tracking nudge) reads this.
  @Prop({ type: Boolean, default: false })
  conversionTrackingReady: boolean;
}

export const GoogleAdsConnectionSchema =
  SchemaFactory.createForClass(GoogleAdsConnection);

// A user can have at most one active Google Ads connection per client.
GoogleAdsConnectionSchema.index(
  { userId: 1, clientId: 1 },
  { unique: true },
);
