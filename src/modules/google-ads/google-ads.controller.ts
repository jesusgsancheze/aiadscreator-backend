import {
  Controller,
  Post,
  Get,
  Delete,
  Query,
  Param,
  Body,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ObjectIdValidationPipe } from '../../common/pipes/object-id-validation.pipe';
import { GoogleAdsService } from './google-ads.service';
import { GoogleAdsConnectionService } from './google-ads-connection.service';
import { GoogleAdsPublishService } from './google-ads-publish.service';
import { SelectCustomerDto } from './dto/select-customer.dto';
import { PublishPmaxDto } from './dto/publish-pmax.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Campaign, CampaignDocument } from '../campaigns/schemas/campaign.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';

@Controller('google-ads')
export class GoogleAdsController {
  constructor(
    private readonly googleAdsService: GoogleAdsService,
    private readonly connectionService: GoogleAdsConnectionService,
    private readonly publishService: GoogleAdsPublishService,
    private readonly configService: ConfigService,
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>,
  ) {}

  /**
   * Authed endpoint. Builds a Google OAuth URL with a signed state JWT and
   * returns it. The frontend then redirects (or opens a popup) to that URL.
   * We return the URL rather than 302 so the frontend can decide whether to
   * use a full redirect or a popup.
   */
  @UseGuards(JwtAuthGuard)
  @Get('oauth/start')
  startOAuth(
    @CurrentUser('userId') userId: string,
    @Query('clientId') clientId: string,
  ): { authUrl: string } {
    if (!clientId || !/^[a-f0-9]{24}$/i.test(clientId)) {
      throw new BadRequestException('Valid clientId is required');
    }
    if (!this.googleAdsService.isConfigured) {
      throw new BadRequestException(
        'Google Ads integration is not configured on this server.',
      );
    }
    const state = this.connectionService.signOAuthState(userId, clientId);
    const authUrl = this.googleAdsService.buildAuthorizationUrl(state);
    return { authUrl };
  }

  /**
   * Public endpoint (Google redirects here without our auth). Validates the
   * signed state JWT, exchanges the code for tokens, lists accessible
   * customers, upserts the connection, then redirects the user back to the
   * frontend where a customer-picker modal will handle the final step.
   *
   * Redirects to: `${FRONTEND_URL}/google-ads/connected?connectionId=<id>&status=<status>`
   *   status = 'picker' | 'done' | 'error'
   */
  @Get('oauth/callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const frontendBase =
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:4000';

    if (error) {
      return res.redirect(
        `${frontendBase}/google-ads/connected?status=error&message=${encodeURIComponent(error)}`,
      );
    }
    if (!code || !state) {
      return res.redirect(
        `${frontendBase}/google-ads/connected?status=error&message=missing_code_or_state`,
      );
    }

    try {
      const { userId, clientId } = this.connectionService.verifyOAuthState(state);
      const tokens = await this.googleAdsService.exchangeCodeForTokens(code);
      const accessibleCustomers =
        await this.googleAdsService.listAccessibleCustomers(tokens.accessToken);
      const connection = await this.connectionService.upsertFromOAuthCallback({
        userId,
        clientId,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        accessibleCustomers,
      });

      // If there's exactly one accessible customer we auto-activated; skip
      // the picker and go straight to done.
      const status =
        accessibleCustomers.length === 1 && connection.isActive
          ? 'done'
          : 'picker';

      return res.redirect(
        `${frontendBase}/google-ads/connected?status=${status}&connectionId=${connection._id}`,
      );
    } catch (err: any) {
      return res.redirect(
        `${frontendBase}/google-ads/connected?status=error&message=${encodeURIComponent(
          err.message || 'connection_failed',
        )}`,
      );
    }
  }

  /**
   * After OAuth, the frontend fetches this to populate its customer-picker.
   */
  @UseGuards(JwtAuthGuard)
  @Get('connections/:id')
  async getConnection(
    @CurrentUser('userId') userId: string,
    @Param('id', ObjectIdValidationPipe) id: string,
  ) {
    const connection = await this.connectionService.findById(id);
    if (connection.userId.toString() !== userId) {
      throw new BadRequestException('You do not own this connection.');
    }
    // Never expose the refresh token.
    const {
      refreshToken: _omitRefresh,
      accessToken: _omitAccess,
      ...safe
    } = connection.toObject();
    return safe;
  }

  /**
   * Convenience lookup: does this (user, client) pair have a connection yet?
   */
  @UseGuards(JwtAuthGuard)
  @Get('connections/by-client/:clientId')
  async getConnectionByClient(
    @CurrentUser('userId') userId: string,
    @Param('clientId', ObjectIdValidationPipe) clientId: string,
  ) {
    const connection =
      await this.connectionService.findByUserAndClientOrNull(userId, clientId);
    if (!connection) return null;
    const {
      refreshToken: _omitRefresh,
      accessToken: _omitAccess,
      ...safe
    } = connection.toObject();
    return safe;
  }

  @UseGuards(JwtAuthGuard)
  @Get('connections')
  async listConnections(@CurrentUser('userId') userId: string) {
    const connections = await this.connectionService.findAllByUser(userId);
    return connections.map((c) => {
      const {
        refreshToken: _omitRefresh,
        accessToken: _omitAccess,
        ...safe
      } = c.toObject();
      return safe;
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('connections/:id/select-customer')
  async selectCustomer(
    @CurrentUser('userId') userId: string,
    @Param('id', ObjectIdValidationPipe) id: string,
    @Body() dto: SelectCustomerDto,
  ) {
    const connection = await this.connectionService.selectCustomer(
      id,
      userId,
      dto,
    );
    const {
      refreshToken: _omitRefresh,
      accessToken: _omitAccess,
      ...safe
    } = connection.toObject();
    return safe;
  }

  @UseGuards(JwtAuthGuard)
  @Post('connections/:id/verify')
  async verifyConnection(
    @CurrentUser('userId') userId: string,
    @Param('id', ObjectIdValidationPipe) id: string,
  ) {
    return this.connectionService.verify(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('connections/:id')
  async deleteConnection(
    @CurrentUser('userId') userId: string,
    @Param('id', ObjectIdValidationPipe) id: string,
  ) {
    const connection = await this.connectionService.delete(id, userId);
    return { _id: connection._id, isActive: connection.isActive };
  }

  /**
   * Publishes a google_pmax campaign to Google Ads. Creates the campaign
   * paused — the user must un-pause from within Google Ads UI to start
   * delivery. Persists the returned Google IDs on the campaign.
   */
  @UseGuards(JwtAuthGuard)
  @Post('publish')
  async publishCampaign(
    @CurrentUser('userId') userId: string,
    @Body() dto: PublishPmaxDto,
  ) {
    const campaign = await this.campaignModel.findById(dto.campaignId);
    if (!campaign) {
      throw new BadRequestException('Campaign not found');
    }
    if (campaign.userId.toString() !== userId) {
      throw new BadRequestException('You do not own this campaign.');
    }
    if (campaign.socialMedia !== 'google_pmax') {
      throw new BadRequestException(
        'This campaign is not a Google Performance Max campaign.',
      );
    }

    const connection = await this.connectionService.findByUserAndClient(
      userId,
      campaign.clientId.toString(),
    );
    if (!connection.isActive || !connection.customerId) {
      throw new BadRequestException(
        'Google Ads connection is not active. Reconnect and pick a customer.',
      );
    }

    const client = await this.clientModel.findById(campaign.clientId);
    if (!client) {
      throw new BadRequestException('Client not found.');
    }

    const result = await this.publishService.publishPmaxCampaign(
      connection,
      { name: client.name, logo: client.logo },
      {
        _id: campaign._id.toString(),
        title: campaign.title,
        campaignDescription: campaign.campaignDescription,
        headlines: campaign.headlines,
        longHeadlines: campaign.longHeadlines,
        descriptions: campaign.descriptions,
        businessName: campaign.businessName,
        generatedImages: campaign.generatedImages,
        selectedImage: campaign.selectedImage,
        landscapeImages: campaign.landscapeImages,
        selectedLandscapeImage: campaign.selectedLandscapeImage,
        socialMediaLink: campaign.socialMediaLink,
        googleAdsSuggestion: campaign.googleAdsSuggestion,
      },
      dto,
    );

    await this.campaignModel.findByIdAndUpdate(dto.campaignId, {
      googleCustomerId: result.googleCustomerId,
      googleAdsCampaignId: result.googleAdsCampaignId,
      googleAssetGroupId: result.googleAssetGroupId,
      googleAdsStatus: result.googleAdsStatus,
      status: 'published',
    });

    return result;
  }
}
