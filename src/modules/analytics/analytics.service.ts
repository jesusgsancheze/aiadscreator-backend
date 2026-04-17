import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
  ) {}

  async getPerformanceInsights(userId: string, platform?: string) {
    const matchFilter: any = {
      userId: new Types.ObjectId(userId),
      performanceScore: { $ne: null },
    };
    if (platform) {
      matchFilter.socialMedia = platform;
    }

    const insights = await this.campaignModel
      .aggregate([
        { $match: matchFilter },
        { $sort: { performanceScore: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'clients',
            localField: 'clientId',
            foreignField: '_id',
            as: 'client',
          },
        },
        { $unwind: { path: '$client', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            socialMedia: 1,
            campaignDescription: 1,
            copy: 1,
            caption: 1,
            performanceScore: 1,
            analytics: 1,
            status: 1,
            createdAt: 1,
            'client.name': 1,
            'client.logo': 1,
          },
        },
      ])
      .exec();

    return insights;
  }

  async getDashboardStats(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    const [totalCampaigns, activeCampaigns, avgPerformance, totalClients] =
      await Promise.all([
        this.campaignModel.countDocuments({ userId: userObjectId }).exec(),
        this.campaignModel
          .countDocuments({
            userId: userObjectId,
            status: { $in: ['generating', 'ready', 'published'] },
          })
          .exec(),
        this.campaignModel
          .aggregate([
            {
              $match: {
                userId: userObjectId,
                performanceScore: { $ne: null },
              },
            },
            { $group: { _id: null, avg: { $avg: '$performanceScore' } } },
          ])
          .exec()
          .then((res) =>
            res.length > 0 ? Math.round(res[0].avg * 10) / 10 : 0,
          ),
        this.clientModel.countDocuments({ userId: userObjectId }).exec(),
      ]);

    return {
      totalCampaigns,
      activeCampaigns,
      avgPerformance,
      totalClients,
    };
  }

  async getPerformanceTimeline(userId: string) {
    const timeline = await this.campaignModel
      .aggregate([
        { $match: { userId: new Types.ObjectId(userId) } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
            },
            count: { $sum: 1 },
            avgScore: { $avg: '$performanceScore' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        {
          $project: {
            _id: 0,
            year: '$_id.year',
            month: '$_id.month',
            count: 1,
            avgScore: { $round: ['$avgScore', 1] },
          },
        },
      ])
      .exec();

    return timeline;
  }
}
