import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import {
  GoogleAdsConnection,
  GoogleAdsConnectionSchema,
} from './schemas/google-ads-connection.schema';
import { GoogleAdsService } from './google-ads.service';
import { GoogleAdsConnectionService } from './google-ads-connection.service';
import { GoogleAdsPublishService } from './google-ads-publish.service';
import { GoogleAdsController } from './google-ads.controller';
import {
  Campaign,
  CampaignSchema,
} from '../campaigns/schemas/campaign.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: GoogleAdsConnection.name, schema: GoogleAdsConnectionSchema },
      { name: Campaign.name, schema: CampaignSchema },
      { name: Client.name, schema: ClientSchema },
    ]),
    // Short-TTL JWT for signing the OAuth state parameter. Uses the same
    // JWT_SECRET as app auth; TTL is set per-token in signOAuthState.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [GoogleAdsController],
  providers: [
    GoogleAdsService,
    GoogleAdsConnectionService,
    GoogleAdsPublishService,
  ],
  exports: [
    GoogleAdsService,
    GoogleAdsConnectionService,
    GoogleAdsPublishService,
  ],
})
export class GoogleAdsModule {}
