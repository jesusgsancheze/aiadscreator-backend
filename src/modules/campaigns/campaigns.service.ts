import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Campaign, CampaignDocument } from './schemas/campaign.schema';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { UpdatePerformanceDto } from './dto/update-performance.dto';
import { SocialMedia } from '../../common/constants';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
  ) {}

  async create(
    dto: CreateCampaignDto,
    userId: string,
    productImages: string[],
  ): Promise<CampaignDocument> {
    const campaign = new this.campaignModel({
      ...dto,
      productImages,
      clientId: new Types.ObjectId(dto.clientId),
      userId: new Types.ObjectId(userId),
    });
    return campaign.save();
  }

  async findAllByUser(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      status?: string;
      socialMedia?: string;
    } = {},
  ): Promise<{ campaigns: CampaignDocument[]; total: number }> {
    const { page = 1, limit = 20, status, socialMedia } = options;
    const skip = (page - 1) * limit;

    const filter: any = { userId: new Types.ObjectId(userId) };
    if (status) filter.status = status;
    if (socialMedia) filter.socialMedia = socialMedia;

    const [campaigns, total] = await Promise.all([
      this.campaignModel
        .find(filter)
        .populate('clientId', 'name logo')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .exec(),
      this.campaignModel.countDocuments(filter).exec(),
    ]);

    return { campaigns, total };
  }

  async findById(id: string): Promise<CampaignDocument> {
    const campaign = await this.campaignModel
      .findById(id)
      .populate('clientId', 'name logo description')
      .exec();
    if (!campaign) {
      throw new NotFoundException('Campaign not found.');
    }
    return campaign;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateCampaignDto,
  ): Promise<CampaignDocument> {
    const campaign = await this.findById(id);
    this.checkOwnership(campaign, userId);

    const updated = await this.campaignModel
      .findByIdAndUpdate(id, dto, { new: true })
      .populate('clientId', 'name logo description')
      .exec();
    return updated!;
  }

  async updatePerformance(
    id: string,
    userId: string,
    dto: UpdatePerformanceDto,
  ): Promise<CampaignDocument> {
    const campaign = await this.findById(id);
    this.checkOwnership(campaign, userId);

    const analytics = { ...(campaign.analytics || {}), ...dto };
    const performanceScore = await this.computePerformanceScore(
      userId,
      analytics,
    );

    const updated = await this.campaignModel
      .findByIdAndUpdate(
        id,
        { analytics, performanceScore },
        { new: true },
      )
      .populate('clientId', 'name logo description')
      .exec();
    return updated!;
  }

  async selectImage(
    id: string,
    userId: string,
    imageIndex: number,
  ): Promise<CampaignDocument> {
    const campaign = await this.findById(id);
    this.checkOwnership(campaign, userId);

    const updated = await this.campaignModel
      .findByIdAndUpdate(id, { selectedImage: imageIndex }, { new: true })
      .populate('clientId', 'name logo description')
      .exec();
    return updated!;
  }

  async delete(id: string, userId: string): Promise<void> {
    const campaign = await this.findById(id);
    this.checkOwnership(campaign, userId);
    await this.campaignModel.findByIdAndDelete(id).exec();
  }

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<{ campaigns: CampaignDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    const [campaigns, total] = await Promise.all([
      this.campaignModel
        .find()
        .populate('clientId', 'name logo')
        .populate('userId', 'email firstName lastName')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .exec(),
      this.campaignModel.countDocuments().exec(),
    ]);
    return { campaigns, total };
  }

  async findTopPerforming(
    userId: string,
    socialMedia?: SocialMedia,
  ): Promise<CampaignDocument[]> {
    const filter: any = {
      userId: new Types.ObjectId(userId),
      performanceScore: { $ne: null },
    };
    if (socialMedia) filter.socialMedia = socialMedia;

    return this.campaignModel
      .find(filter)
      .populate('clientId', 'name logo description')
      .sort({ performanceScore: -1 })
      .limit(5)
      .exec();
  }

  private async computePerformanceScore(
    userId: string,
    analytics: any,
  ): Promise<number> {
    // Get max values from user's campaigns for normalization
    const maxValues = await this.campaignModel
      .aggregate([
        { $match: { userId: new Types.ObjectId(userId), analytics: { $ne: null } } },
        {
          $group: {
            _id: null,
            maxCtr: { $max: '$analytics.ctr' },
            maxConversions: { $max: '$analytics.conversions' },
            maxEngagement: { $max: '$analytics.engagement' },
            maxReach: { $max: '$analytics.reach' },
          },
        },
      ])
      .exec();

    const max = maxValues[0] || {
      maxCtr: 1,
      maxConversions: 1,
      maxEngagement: 1,
      maxReach: 1,
    };

    // Normalize each metric to 0-1
    const normCtr = max.maxCtr ? (analytics.ctr || 0) / max.maxCtr : 0;
    const normConversions = max.maxConversions
      ? (analytics.conversions || 0) / max.maxConversions
      : 0;
    const normEngagement = max.maxEngagement
      ? (analytics.engagement || 0) / max.maxEngagement
      : 0;
    const normReach = max.maxReach
      ? (analytics.reach || 0) / max.maxReach
      : 0;

    // Weighted score: 0.3*ctr + 0.3*conversions + 0.2*engagement + 0.2*reach
    const rawScore =
      0.3 * normCtr +
      0.3 * normConversions +
      0.2 * normEngagement +
      0.2 * normReach;

    // Scale to 1-10
    const score = Math.round((rawScore * 9 + 1) * 10) / 10;
    return Math.min(10, Math.max(1, score));
  }

  private checkOwnership(campaign: CampaignDocument, userId: string): void {
    if (campaign.userId.toString() !== userId) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }
  }
}
