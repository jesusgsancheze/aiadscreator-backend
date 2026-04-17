import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { ClientsService } from '../clients/clients.service';
import { CampaignsService } from '../campaigns/campaigns.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly usersService: UsersService,
    private readonly clientsService: ClientsService,
    private readonly campaignsService: CampaignsService,
  ) {}

  async getAllUsers(page = 1, limit = 20) {
    return this.usersService.findAll(page, limit);
  }

  async getUserById(id: string) {
    const user = await this.usersService.findById(id);
    if (user) {
      const { password, ...result } = user.toObject();
      return result;
    }
    return null;
  }

  async getAllClients(page = 1, limit = 20) {
    return this.clientsService.findAll(page, limit);
  }

  async getAllCampaigns(page = 1, limit = 20) {
    return this.campaignsService.findAll(page, limit);
  }

  async getDashboardStats() {
    const [usersData, clientsData, campaignsData] = await Promise.all([
      this.usersService.findAll(1, 1),
      this.clientsService.findAll(1, 1),
      this.campaignsService.findAll(1, 1),
    ]);

    return {
      totalUsers: usersData.total,
      totalClients: clientsData.total,
      totalCampaigns: campaignsData.total,
    };
  }
}
