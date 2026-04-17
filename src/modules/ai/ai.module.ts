import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AiService } from './ai.service';
import { ClaudeService } from './claude.service';
import { GeminiService } from './gemini.service';
import { Campaign, CampaignSchema } from '../campaigns/schemas/campaign.schema';
import { Client, ClientSchema } from '../clients/schemas/client.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: Client.name, schema: ClientSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [AiService, ClaudeService, GeminiService],
  exports: [AiService],
})
export class AiModule {}
