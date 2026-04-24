import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AiService } from './ai.service';
import { OpenRouterService } from './openrouter.service';
import { Campaign, CampaignSchema } from '../campaigns/schemas/campaign.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { MetaModule } from '../meta/meta.module';
import { GoogleAdsModule } from '../google-ads/google-ads.module';

@Module({
  imports: [
    ConfigModule,
    MetaModule,
    GoogleAdsModule,
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: Client.name, schema: ClientSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [AiService, OpenRouterService],
  exports: [AiService, OpenRouterService],
})
export class AiModule {}
