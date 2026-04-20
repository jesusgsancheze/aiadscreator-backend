import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TokenTransaction,
  TokenTransactionDocument,
} from './schemas/token-transaction.schema';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ReviewTransactionDto } from './dto/review-transaction.dto';
import { AdminGrantTokensDto } from './dto/admin-grant-tokens.dto';
import { TOKEN_COSTS, TransactionStatus } from '../../common/constants';
import { PaymentMethodsService } from './payment-methods.service';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    @InjectModel(TokenTransaction.name)
    private transactionModel: Model<TokenTransactionDocument>,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly paymentMethodsService: PaymentMethodsService,
  ) {}

  calculateCampaignCost(imageCount: number) {
    const copyCaption = TOKEN_COSTS.COPY_AND_CAPTION;
    const images = imageCount * TOKEN_COSTS.PER_IMAGE;
    return { copyCaption, images, total: copyCaption + images };
  }

  async canAffordCampaign(userId: string, imageCount: number) {
    const balance = await this.usersService.getTokenBalance(userId);
    const { total } = this.calculateCampaignCost(imageCount);
    return { canAfford: balance >= total, balance, cost: total };
  }

  async chargeCampaign(
    userId: string,
    imageCount: number,
    campaignId: string,
    textAgent?: string,
    imageAgent?: string,
  ) {
    const cost = this.calculateCampaignCost(imageCount);
    await this.usersService.deductTokens(userId, cost.total);

    // Create separate transactions for copy+caption and images
    const copyTx = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'campaign_spend',
      tokens: cost.copyCaption,
      status: TransactionStatus.APPROVED,
      campaignId,
      description: 'Copy & Caption generation',
      aiAgent: textAgent || null,
    });

    const imageTx = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'campaign_spend',
      tokens: cost.images,
      status: TransactionStatus.APPROVED,
      campaignId,
      description: `${imageCount} image(s) generation`,
      aiAgent: imageAgent || null,
    });

    await Promise.all([copyTx.save(), imageTx.save()]);
  }

  async chargeTokens(
    userId: string,
    amount: number,
    campaignId: string,
    description: string,
    aiAgent?: string,
  ): Promise<void> {
    await this.usersService.deductTokens(userId, amount);
    const transaction = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'campaign_spend',
      tokens: amount,
      status: TransactionStatus.APPROVED,
      campaignId,
      description,
      aiAgent: aiAgent || null,
    });
    await transaction.save();
  }

  async createPurchaseRequest(userId: string, dto: CreateTransactionDto) {
    const transaction = new this.transactionModel({
      userId: new Types.ObjectId(userId),
      type: 'purchase',
      tokens: dto.tokens,
      amountUsd: dto.amountUsd ?? null,
      paymentMethod: dto.paymentMethod,
      paymentReference: dto.paymentReference ?? null,
      packageId: dto.packageId ?? null,
      status: TransactionStatus.PENDING,
    });
    await transaction.save();

    // Send notification to admin emails
    try {
      const adminEmailsSetting =
        await this.paymentMethodsService.getAdminSettings(
          'notificationEmails',
        );
      const adminEmails: string[] = adminEmailsSetting?.value ?? [];
      if (adminEmails.length > 0) {
        const user = await this.usersService.findById(userId);
        if (user) {
          await this.mailService.sendPaymentNotification(
            adminEmails,
            user.email,
            `${user.firstName} ${user.lastName}`,
            dto.amountUsd ?? 0,
            dto.tokens,
            dto.paymentMethod,
          );
        }
      }
    } catch (err) {
      this.logger.error('Failed to send payment notification email', err);
    }

    return transaction;
  }

  async uploadPaymentProof(
    transactionId: string,
    userId: string,
    filePath: string,
  ) {
    const transaction = await this.transactionModel.findOne({
      _id: transactionId,
      userId: new Types.ObjectId(userId),
    });
    if (!transaction) {
      throw new NotFoundException('Transaction not found.');
    }
    if (transaction.status !== TransactionStatus.PENDING) {
      throw new BadRequestException(
        'Can only upload proof for pending transactions.',
      );
    }
    transaction.paymentProof = filePath;
    await transaction.save();
    return transaction;
  }

  async reviewTransaction(
    transactionId: string,
    adminUserId: string,
    dto: ReviewTransactionDto,
  ) {
    const transaction = await this.transactionModel.findById(transactionId);
    if (!transaction) {
      throw new NotFoundException('Transaction not found.');
    }
    if (transaction.status !== TransactionStatus.PENDING) {
      throw new BadRequestException('Transaction has already been reviewed.');
    }

    transaction.status = dto.status;
    transaction.adminNote = dto.adminNote ?? null;
    transaction.reviewedBy = new Types.ObjectId(adminUserId);
    transaction.reviewedAt = new Date();
    await transaction.save();

    if (dto.status === TransactionStatus.APPROVED) {
      await this.usersService.addTokens(
        transaction.userId.toString(),
        transaction.tokens,
      );
    }

    // Send email to user
    try {
      const user = await this.usersService.findById(
        transaction.userId.toString(),
      );
      if (user) {
        await this.mailService.sendPaymentResult(
          user.email,
          user.firstName,
          dto.status,
          transaction.tokens,
          dto.adminNote,
        );
      }
    } catch (err) {
      this.logger.error('Failed to send payment result email', err);
    }

    return transaction;
  }

  async adminGrantTokens(dto: AdminGrantTokensDto, adminUserId: string) {
    await this.usersService.addTokens(dto.userId, dto.tokens);

    const transaction = new this.transactionModel({
      userId: new Types.ObjectId(dto.userId),
      type: 'admin_grant',
      tokens: dto.tokens,
      status: TransactionStatus.APPROVED,
      adminNote: dto.adminNote ?? null,
      reviewedBy: new Types.ObjectId(adminUserId),
      reviewedAt: new Date(),
    });
    await transaction.save();

    return transaction;
  }

  async getTransactionsByUser(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.transactionModel
        .countDocuments({ userId: new Types.ObjectId(userId) })
        .exec(),
    ]);
    return { transactions, total, page, limit };
  }

  async getAllTransactions(
    page = 1,
    limit = 20,
    filters?: {
      status?: string;
      userId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const query: any = {};
    if (filters?.status) query.status = filters.status;
    if (filters?.userId)
      query.userId = new Types.ObjectId(filters.userId);
    if (filters?.dateFrom || filters?.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom)
        query.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
    }

    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find(query)
        .populate('userId', 'email firstName lastName')
        .populate('reviewedBy', 'email firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.transactionModel.countDocuments(query).exec(),
    ]);
    return { transactions, total, page, limit };
  }

  async getIncomeReport(dateFrom?: string, dateTo?: string, userId?: string) {
    const match: any = {
      type: 'purchase',
      status: TransactionStatus.APPROVED,
    };
    if (dateFrom || dateTo) {
      match.createdAt = {};
      if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
      if (dateTo) match.createdAt.$lte = new Date(dateTo);
    }
    if (userId) {
      match.userId = new Types.ObjectId(userId);
    }

    const [totals] = await this.transactionModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalIncome: { $sum: '$amountUsd' },
          totalTokensSold: { $sum: '$tokens' },
          count: { $sum: 1 },
        },
      },
    ]);

    const byPaymentMethod = await this.transactionModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$paymentMethod',
          totalIncome: { $sum: '$amountUsd' },
          totalTokens: { $sum: '$tokens' },
          count: { $sum: 1 },
        },
      },
    ]);

    return {
      totalIncome: totals?.totalIncome ?? 0,
      totalTokensSold: totals?.totalTokensSold ?? 0,
      transactionCount: totals?.count ?? 0,
      byPaymentMethod,
    };
  }
}
