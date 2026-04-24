import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  GoogleAdsConnection,
  GoogleAdsConnectionDocument,
} from './schemas/google-ads-connection.schema';

/**
 * Low-level Google Ads + Google OAuth helpers. Does NOT handle persistence —
 * that's GoogleAdsConnectionService's job. This service is stateless and can
 * be called from anywhere that needs to hit Google's APIs.
 */
export interface GoogleAdsCampaignHistoryItem {
  name: string;
  channelType?: string;
  biddingStrategy?: string;
  dailyBudget?: number; // USD whole units
  metrics?: {
    conversions: number;
    costUsd: number;
    ctr: number; // percentage
    cpaUsd: number;
    roas: number;
  };
}

@Injectable()
export class GoogleAdsService {
  private readonly logger = new Logger(GoogleAdsService.name);
  private readonly oauthTokenUrl = 'https://oauth2.googleapis.com/token';
  private readonly googleAdsApiBase = 'https://googleads.googleapis.com/v18';
  private readonly oauthScope = 'https://www.googleapis.com/auth/adwords';
  private readonly historyCache = new Map<
    string,
    { timestamp: number; data: GoogleAdsCampaignHistoryItem[] }
  >();
  private readonly HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;

  constructor(private readonly configService: ConfigService) {}

  get isConfigured(): boolean {
    return (
      !!this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID') &&
      !!this.configService.get<string>('GOOGLE_OAUTH_CLIENT_SECRET') &&
      !!this.configService.get<string>('GOOGLE_ADS_DEVELOPER_TOKEN')
    );
  }

  private requireConfig<T extends string>(key: T): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(
        `${key} is not configured. Google Ads integration is disabled.`,
      );
    }
    return value;
  }

  /**
   * Builds the Google OAuth consent URL for the PMax connect flow.
   * `state` must be a signed JWT that the caller generates and validates on
   * the callback side — never trust raw state from the URL.
   */
  buildAuthorizationUrl(state: string): string {
    const clientId = this.requireConfig('GOOGLE_OAUTH_CLIENT_ID');
    const redirectUri = this.requireConfig('GOOGLE_OAUTH_REDIRECT_URI');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.oauthScope,
      state,
      // offline → return a refresh_token; consent → force re-issuing it even
      // if the user consented before. Without prompt=consent Google will
      // return NO refresh_token on repeat OAuth attempts, leaving us with
      // only a 1-hour access token.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchanges an authorization_code for { access_token, refresh_token, expires_in, scope }.
   */
  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scopes: string[];
  }> {
    const clientId = this.requireConfig('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = this.requireConfig('GOOGLE_OAUTH_CLIENT_SECRET');
    const redirectUri = this.requireConfig('GOOGLE_OAUTH_REDIRECT_URI');

    try {
      const response = await axios.post(
        this.oauthTokenUrl,
        new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const data = response.data;
      if (!data.refresh_token) {
        // This happens if the user previously consented and we forgot to send
        // prompt=consent. The flow is unusable without a refresh_token.
        throw new BadRequestException(
          'Google did not return a refresh token. Revoke the app at myaccount.google.com/permissions and retry the connection.',
        );
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
        scopes:
          typeof data.scope === 'string'
            ? data.scope.split(' ').filter(Boolean)
            : [this.oauthScope],
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(
        `OAuth token exchange failed: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `OAuth token exchange failed: ${error.response?.data?.error_description || error.message}`,
      );
    }
  }

  /**
   * Refreshes the access_token using the stored refresh_token. Returns the
   * new access_token and expiry. Does not mutate the connection — caller
   * persists the result.
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const clientId = this.requireConfig('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = this.requireConfig('GOOGLE_OAUTH_CLIENT_SECRET');

    try {
      const response = await axios.post(
        this.oauthTokenUrl,
        new URLSearchParams({
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      return {
        accessToken: response.data.access_token,
        expiresAt: new Date(
          Date.now() + (response.data.expires_in ?? 3600) * 1000,
        ),
      };
    } catch (error: any) {
      this.logger.error(
        `OAuth refresh failed: ${error.message}`,
        error.response?.data,
      );
      // invalid_grant = refresh token was revoked or expired. Connection
      // needs re-consent.
      if (error.response?.data?.error === 'invalid_grant') {
        throw new BadRequestException(
          'Google refresh token has been revoked. Reconnect the Google Ads account.',
        );
      }
      throw new BadRequestException(
        `OAuth refresh failed: ${error.response?.data?.error_description || error.message}`,
      );
    }
  }

  /**
   * Returns a valid access token, refreshing if expired (or within 60s of
   * expiry to avoid edge races). Mutates the connection in place with a
   * fresh token if refreshed — caller is responsible for saving.
   */
  async getFreshAccessToken(
    connection: GoogleAdsConnectionDocument,
  ): Promise<string> {
    const now = Date.now();
    const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? 0;
    if (connection.accessToken && expiresAt - now > 60_000) {
      return connection.accessToken;
    }
    const { accessToken, expiresAt: newExpiresAt } =
      await this.refreshAccessToken(connection.refreshToken);
    connection.accessToken = accessToken;
    connection.accessTokenExpiresAt = newExpiresAt;
    await connection.save();
    return accessToken;
  }

  /**
   * Calls customers:listAccessibleCustomers — the only Google Ads endpoint
   * that works without a customer_id. Returns the list of customer IDs
   * (digits only) that the authenticated user can access.
   */
  async listAccessibleCustomers(accessToken: string): Promise<string[]> {
    const developerToken = this.requireConfig('GOOGLE_ADS_DEVELOPER_TOKEN');
    try {
      const response = await axios.get(
        `${this.googleAdsApiBase}/customers:listAccessibleCustomers`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'developer-token': developerToken,
          },
        },
      );
      const resourceNames: string[] = response.data?.resourceNames ?? [];
      // Each entry looks like "customers/1234567890" — strip the prefix.
      return resourceNames
        .map((rn) => rn.replace(/^customers\//, ''))
        .filter((id) => /^\d{10}$/.test(id));
    } catch (error: any) {
      this.logger.error(
        `listAccessibleCustomers failed: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Failed to list Google Ads customers: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  /**
   * Runs a GAQL query. Used by Phase 4b onward for fetching campaign history,
   * conversion actions, asset groups, etc. Caller supplies the customerId.
   */
  async searchGaql<T = any>(
    accessToken: string,
    customerId: string,
    query: string,
    loginCustomerId?: string | null,
  ): Promise<T[]> {
    const developerToken = this.requireConfig('GOOGLE_ADS_DEVELOPER_TOKEN');
    const effectiveLoginCustomer =
      loginCustomerId ||
      this.configService.get<string>('GOOGLE_ADS_LOGIN_CUSTOMER_ID') ||
      undefined;
    try {
      const response = await axios.post(
        `${this.googleAdsApiBase}/customers/${customerId}/googleAds:search`,
        { query },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'developer-token': developerToken,
            ...(effectiveLoginCustomer
              ? { 'login-customer-id': effectiveLoginCustomer }
              : {}),
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data?.results ?? [];
    } catch (error: any) {
      this.logger.error(
        `GAQL search failed on ${customerId}: ${error.message}`,
        error.response?.data,
      );
      throw new BadRequestException(
        `Google Ads query failed: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  /**
   * Light verification that a connection is live and points at a real customer.
   * Queries `customer` for id/descriptiveName/currencyCode.
   */
  async verifyCustomer(
    accessToken: string,
    customerId: string,
    loginCustomerId?: string | null,
  ): Promise<{
    id: string;
    descriptiveName: string;
    currencyCode: string;
  }> {
    const results = await this.searchGaql<any>(
      accessToken,
      customerId,
      'SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1',
      loginCustomerId,
    );
    const customer = results[0]?.customer;
    if (!customer) {
      throw new BadRequestException(
        `No Google Ads customer found for ID ${customerId}`,
      );
    }
    return {
      id: String(customer.id),
      descriptiveName: String(customer.descriptiveName ?? ''),
      currencyCode: String(customer.currencyCode ?? ''),
    };
  }

  /**
   * Returns whether the customer has at least one ENABLED conversion action.
   * Used by the Phase 6 conversion-tracking nudge.
   */
  async hasEnabledConversionActions(
    accessToken: string,
    customerId: string,
    loginCustomerId?: string | null,
  ): Promise<boolean> {
    try {
      const results = await this.searchGaql<any>(
        accessToken,
        customerId,
        "SELECT conversion_action.id FROM conversion_action WHERE conversion_action.status = 'ENABLED' LIMIT 1",
        loginCustomerId,
      );
      return results.length > 0;
    } catch (error: any) {
      // Don't fail the whole connection over a conversion-action query failure.
      this.logger.warn(
        `Conversion-action check failed on ${customerId}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Fetches the customer's past 90 days of campaigns, ranked by conversions,
   * normalized into a compact shape the AI prompt can consume. Uses an
   * in-memory cache (1h TTL per customerId) to avoid hammering GAQL on every
   * campaign generation. Fully best-effort: any failure returns `[]`.
   */
  async fetchCampaignHistory(
    accessToken: string,
    customerId: string,
    loginCustomerId?: string | null,
  ): Promise<GoogleAdsCampaignHistoryItem[]> {
    const cached = this.historyCache.get(customerId);
    if (cached && Date.now() - cached.timestamp < this.HISTORY_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const results = await this.searchGaql<any>(
        accessToken,
        customerId,
        `
        SELECT
          campaign.id,
          campaign.name,
          campaign.advertising_channel_type,
          campaign.bidding_strategy_type,
          campaign_budget.amount_micros,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.clicks,
          metrics.impressions,
          metrics.ctr,
          metrics.average_cost
        FROM campaign
        WHERE segments.date DURING LAST_90_DAYS
          AND campaign.status != 'REMOVED'
        ORDER BY metrics.conversions DESC
        LIMIT 20
        `.trim(),
        loginCustomerId,
      );

      const normalized: GoogleAdsCampaignHistoryItem[] = results.map((r) => {
        const metrics = r.metrics ?? {};
        const costMicros = Number(metrics.costMicros ?? 0);
        const costUsd = costMicros / 1_000_000;
        const conversions = Number(metrics.conversions ?? 0);
        const conversionsValue = Number(metrics.conversionsValue ?? 0);
        const cpaUsd = conversions > 0 ? costUsd / conversions : 0;
        const roas = costUsd > 0 ? conversionsValue / costUsd : 0;
        return {
          name: String(r.campaign?.name ?? 'Unnamed campaign'),
          channelType: r.campaign?.advertisingChannelType,
          biddingStrategy: r.campaign?.biddingStrategyType,
          dailyBudget: r.campaignBudget?.amountMicros
            ? Number(r.campaignBudget.amountMicros) / 1_000_000
            : undefined,
          metrics: {
            conversions,
            costUsd,
            ctr: Number(metrics.ctr ?? 0),
            cpaUsd,
            roas,
          },
        };
      });

      // Filter to campaigns that actually spent money (noise filter) and keep top 5.
      const withSpend = normalized
        .filter((c) => c.metrics && c.metrics.costUsd > 0)
        .sort(
          (a, b) =>
            (b.metrics?.conversions ?? 0) - (a.metrics?.conversions ?? 0) ||
            (b.metrics?.costUsd ?? 0) - (a.metrics?.costUsd ?? 0),
        )
        .slice(0, 5);

      this.historyCache.set(customerId, {
        timestamp: Date.now(),
        data: withSpend,
      });
      this.logger.log(
        `Fetched ${withSpend.length} ranked Google Ads campaigns for ${customerId}`,
      );
      return withSpend;
    } catch (error: any) {
      this.logger.warn(
        `Failed to fetch Google Ads campaign history for ${customerId}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Executes a mutate_operations batch. Returns the ordered `results` array
   * (each entry has a `resource_name` for the created/updated resource) so
   * the caller can index into it.
   */
  async mutate(
    accessToken: string,
    customerId: string,
    mutateOperations: any[],
    loginCustomerId?: string | null,
  ): Promise<Array<{ [key: string]: any }>> {
    const developerToken = this.requireConfig('GOOGLE_ADS_DEVELOPER_TOKEN');
    const effectiveLoginCustomer =
      loginCustomerId ||
      this.configService.get<string>('GOOGLE_ADS_LOGIN_CUSTOMER_ID') ||
      undefined;
    try {
      const response = await axios.post(
        `${this.googleAdsApiBase}/customers/${customerId}/googleAds:mutate`,
        { mutateOperations },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'developer-token': developerToken,
            ...(effectiveLoginCustomer
              ? { 'login-customer-id': effectiveLoginCustomer }
              : {}),
            'Content-Type': 'application/json',
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );
      return response.data?.mutateOperationResponses ?? [];
    } catch (error: any) {
      const details = error.response?.data;
      this.logger.error(
        `Google Ads mutate failed on ${customerId}: ${error.message}`,
        details,
      );
      // Surface the first specific error Google returned — hugely more
      // useful for debugging than the generic "Bad Request".
      const googleError =
        details?.error?.details?.[0]?.errors?.[0]?.message ||
        details?.error?.message ||
        error.message;
      throw new BadRequestException(
        `Google Ads mutate failed: ${googleError}`,
      );
    }
  }

  // re-export scope for the controller's consent-screen messaging
  readonly requestedScope = this.oauthScope;
  readonly connectionModelName = GoogleAdsConnection.name;
}
