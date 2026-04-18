import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MetaConnection,
  MetaConnectionSchema,
} from './schemas/meta-connection.schema';
import { Campaign, CampaignSchema } from '../campaigns/schemas/campaign.schema';
import { MetaService } from './meta.service';
import { MetaConnectionService } from './meta-connection.service';
import { MetaController } from './meta.controller';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: MetaConnection.name, schema: MetaConnectionSchema },
      { name: Campaign.name, schema: CampaignSchema },
    ]),
  ],
  controllers: [MetaController],
  providers: [MetaService, MetaConnectionService],
  exports: [MetaService, MetaConnectionService],
})
export class MetaModule {}
