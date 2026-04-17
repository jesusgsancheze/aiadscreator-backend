import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { ClientsModule } from '../clients/clients.module';
import { CampaignsModule } from '../campaigns/campaigns.module';

@Module({
  imports: [UsersModule, ClientsModule, CampaignsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
