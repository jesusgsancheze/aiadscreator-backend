import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  GoogleAdsConnection,
  GoogleAdsConnectionDocument,
} from './schemas/google-ads-connection.schema';
import { GoogleAdsService } from './google-ads.service';
import { SelectCustomerDto } from './dto/select-customer.dto';

interface OAuthStatePayload {
  userId: string;
  clientId: string;
  purpose: 'google-ads-connect';
}

@Injectable()
export class GoogleAdsConnectionService {
  private readonly logger = new Logger(GoogleAdsConnectionService.name);
  private readonly stateTtlSeconds = 10 * 60; // 10 min — enough for slow OAuth UX.

  constructor(
    @InjectModel(GoogleAdsConnection.name)
    private readonly connectionModel: Model<GoogleAdsConnectionDocument>,
    private readonly googleAdsService: GoogleAdsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // --- OAuth state (signed JWT, short TTL, bound to user + client) ---

  signOAuthState(userId: string, clientId: string): string {
    const payload: OAuthStatePayload = {
      userId,
      clientId,
      purpose: 'google-ads-connect',
    };
    return this.jwtService.sign(payload, { expiresIn: this.stateTtlSeconds });
  }

  verifyOAuthState(state: string): OAuthStatePayload {
    try {
      const payload = this.jwtService.verify<OAuthStatePayload>(state);
      if (payload.purpose !== 'google-ads-connect') {
        throw new Error('wrong state purpose');
      }
      return payload;
    } catch (error: any) {
      throw new UnauthorizedException(
        `Invalid or expired OAuth state: ${error.message}`,
      );
    }
  }

  // --- CRUD ---

  async findByUserAndClient(
    userId: string,
    clientId: string,
  ): Promise<GoogleAdsConnectionDocument> {
    const connection = await this.connectionModel.findOne({
      userId: new Types.ObjectId(userId),
      clientId: new Types.ObjectId(clientId),
    });
    if (!connection) {
      throw new NotFoundException(
        `No Google Ads connection found for client ${clientId}`,
      );
    }
    return connection;
  }

  async findByUserAndClientOrNull(
    userId: string,
    clientId: string,
  ): Promise<GoogleAdsConnectionDocument | null> {
    return this.connectionModel.findOne({
      userId: new Types.ObjectId(userId),
      clientId: new Types.ObjectId(clientId),
    });
  }

  async findAllByUser(
    userId: string,
  ): Promise<GoogleAdsConnectionDocument[]> {
    return this.connectionModel.find({
      userId: new Types.ObjectId(userId),
      isActive: true,
    });
  }

  async findById(id: string): Promise<GoogleAdsConnectionDocument> {
    const connection = await this.connectionModel.findById(id);
    if (!connection) {
      throw new NotFoundException(`Google Ads connection not found`);
    }
    return connection;
  }

  /**
   * Called from the OAuth callback. Upserts a (userId, clientId) connection
   * with fresh OAuth tokens and the list of accessible customers.
   * customerId stays null until the user picks one in the frontend.
   */
  async upsertFromOAuthCallback(args: {
    userId: string;
    clientId: string;
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: Date;
    scopes: string[];
    accessibleCustomers: string[];
  }): Promise<GoogleAdsConnectionDocument> {
    const filter = {
      userId: new Types.ObjectId(args.userId),
      clientId: new Types.ObjectId(args.clientId),
    };
    const update = {
      ...filter,
      refreshToken: args.refreshToken,
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      scopes: args.scopes,
      accessibleCustomers: args.accessibleCustomers,
      // Only one accessible customer → auto-select it; else user picks next.
      customerId:
        args.accessibleCustomers.length === 1
          ? args.accessibleCustomers[0]
          : null,
      isActive: args.accessibleCustomers.length === 1,
      lastVerified: args.accessibleCustomers.length === 1 ? new Date() : null,
    };
    const connection = await this.connectionModel.findOneAndUpdate(
      filter,
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.logger.log(
      `Google Ads OAuth connection upserted for user ${args.userId}, client ${args.clientId}, ` +
        `accessible customers: ${args.accessibleCustomers.length}`,
    );
    return connection!;
  }

  /**
   * User picks which customer ID to use from the accessibleCustomers list.
   * Verifies the pick against Google, records conversion-tracking readiness,
   * and activates the connection.
   */
  async selectCustomer(
    connectionId: string,
    userId: string,
    dto: SelectCustomerDto,
  ): Promise<GoogleAdsConnectionDocument> {
    const connection = await this.connectionModel.findOne({
      _id: new Types.ObjectId(connectionId),
      userId: new Types.ObjectId(userId),
    });
    if (!connection) {
      throw new NotFoundException('Google Ads connection not found');
    }
    if (!connection.accessibleCustomers.includes(dto.customerId)) {
      throw new BadRequestException(
        `Customer ID ${dto.customerId} is not in the accessible customers list. Reconnect to refresh.`,
      );
    }

    const accessToken =
      await this.googleAdsService.getFreshAccessToken(connection);
    const info = await this.googleAdsService.verifyCustomer(
      accessToken,
      dto.customerId,
      dto.loginCustomerId,
    );

    // Best-effort conversion-action check (Phase 6 uses this to decide whether
    // to show the "set up conversion tracking first" nudge).
    const hasConversions =
      await this.googleAdsService.hasEnabledConversionActions(
        accessToken,
        dto.customerId,
        dto.loginCustomerId,
      );

    connection.customerId = dto.customerId;
    connection.loginCustomerId = dto.loginCustomerId ?? null;
    connection.isActive = true;
    connection.lastVerified = new Date();
    connection.conversionTrackingReady = hasConversions;
    await connection.save();

    this.logger.log(
      `Google Ads customer ${info.id} (${info.descriptiveName}, ${info.currencyCode}) ` +
        `selected for connection ${connectionId}. conversion-tracking=${hasConversions}`,
    );
    return connection;
  }

  async verify(
    connectionId: string,
    userId: string,
  ): Promise<{
    valid: boolean;
    descriptiveName: string;
    currencyCode: string;
    conversionTrackingReady: boolean;
  }> {
    const connection = await this.connectionModel.findOne({
      _id: new Types.ObjectId(connectionId),
      userId: new Types.ObjectId(userId),
    });
    if (!connection) {
      throw new NotFoundException('Google Ads connection not found');
    }
    if (!connection.customerId) {
      throw new BadRequestException(
        'No customer selected yet. Finish the connection flow first.',
      );
    }

    const accessToken =
      await this.googleAdsService.getFreshAccessToken(connection);
    const info = await this.googleAdsService.verifyCustomer(
      accessToken,
      connection.customerId,
      connection.loginCustomerId,
    );
    const hasConversions =
      await this.googleAdsService.hasEnabledConversionActions(
        accessToken,
        connection.customerId,
        connection.loginCustomerId,
      );

    connection.lastVerified = new Date();
    connection.conversionTrackingReady = hasConversions;
    await connection.save();

    return {
      valid: true,
      descriptiveName: info.descriptiveName,
      currencyCode: info.currencyCode,
      conversionTrackingReady: hasConversions,
    };
  }

  async delete(
    connectionId: string,
    userId: string,
  ): Promise<GoogleAdsConnectionDocument> {
    const connection = await this.connectionModel.findOne({
      _id: new Types.ObjectId(connectionId),
      userId: new Types.ObjectId(userId),
    });
    if (!connection) {
      throw new NotFoundException('Google Ads connection not found');
    }
    connection.isActive = false;
    connection.refreshToken = ''; // wipe token on deactivation
    connection.accessToken = null;
    connection.accessTokenExpiresAt = null;
    await connection.save();
    this.logger.log(`Google Ads connection ${connectionId} deactivated`);
    return connection;
  }
}
