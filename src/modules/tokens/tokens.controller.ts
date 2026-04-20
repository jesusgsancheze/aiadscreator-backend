import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TokensService } from './tokens.service';
import { PaymentMethodsService } from './payment-methods.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/constants';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ReviewTransactionDto } from './dto/review-transaction.dto';
import { AdminGrantTokensDto } from './dto/admin-grant-tokens.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { UpdateAdminSettingsDto } from './dto/update-admin-settings.dto';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { ObjectIdValidationPipe } from '../../common/pipes/object-id-validation.pipe';

@UseGuards(JwtAuthGuard)
@Controller('tokens')
export class TokensController {
  constructor(
    private readonly tokensService: TokensService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly usersService: UsersService,
    private readonly uploadService: UploadService,
  ) {}

  // ─── User endpoints ───

  @Get('balance')
  async getBalance(@CurrentUser('userId') userId: string) {
    const balance = await this.usersService.getTokenBalance(userId);
    return { balance };
  }

  @Get('campaign-cost')
  getCampaignCost(@Query('imageCount') imageCount: string) {
    const count = parseInt(imageCount, 10) || 3;
    return this.tokensService.calculateCampaignCost(count);
  }

  @Post('purchase')
  async createPurchase(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.tokensService.createPurchaseRequest(userId, dto);
  }

  @Post('purchase/:id/proof')
  @UseInterceptors(FileInterceptor('proof'))
  async uploadProof(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Proof image is required.');
    }
    const filePath = await this.uploadService.saveFile(file);
    return this.tokensService.uploadPaymentProof(id, userId, filePath);
  }

  @Get('transactions')
  async getUserTransactions(
    @CurrentUser('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tokensService.getTransactionsByUser(
      userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ─── Admin endpoints ───

  @Get('admin/transactions')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN)
  async getAllTransactions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.tokensService.getAllTransactions(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      { status, userId, dateFrom, dateTo },
    );
  }

  @Post('admin/grant')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN)
  async grantTokens(
    @Body() dto: AdminGrantTokensDto,
    @CurrentUser('userId') adminUserId: string,
  ) {
    return this.tokensService.adminGrantTokens(dto, adminUserId);
  }

  @Patch('admin/transactions/:id/review')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN)
  async reviewTransaction(
    @Param('id', ObjectIdValidationPipe) id: string,
    @CurrentUser('userId') adminUserId: string,
    @Body() dto: ReviewTransactionDto,
  ) {
    return this.tokensService.reviewTransaction(id, adminUserId, dto);
  }

  @Get('admin/income-report')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN)
  async getIncomeReport(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('userId') userId?: string,
  ) {
    return this.tokensService.getIncomeReport(dateFrom, dateTo, userId);
  }

  @Get('admin/payment-methods')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN)
  async getPaymentMethods() {
    return this.paymentMethodsService.getAllPaymentMethods();
  }

  @Patch('admin/payment-methods/:type')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN)
  async updatePaymentMethod(
    @Param('type') type: string,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    return this.paymentMethodsService.updatePaymentMethod(type, dto);
  }

  @Get('admin/settings/:key')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN)
  async getAdminSetting(@Param('key') key: string) {
    return this.paymentMethodsService.getAdminSettings(key);
  }

  @Patch('admin/settings/:key')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN)
  async setAdminSetting(
    @Param('key') key: string,
    @Req() req: any,
  ) {
    const value = req.body?.value;
    if (value === undefined) {
      throw new BadRequestException('value is required');
    }
    return this.paymentMethodsService.setAdminSettings(key, value);
  }
}
