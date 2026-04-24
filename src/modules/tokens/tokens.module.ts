import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TokenTransaction,
  TokenTransactionSchema,
} from './schemas/token-transaction.schema';
import {
  PaymentMethodConfig,
  PaymentMethodConfigSchema,
} from './schemas/payment-method-config.schema';
import {
  AdminSettings,
  AdminSettingsSchema,
} from './schemas/admin-settings.schema';
import { TokensService } from './tokens.service';
import { PaymentMethodsService } from './payment-methods.service';
import { TokensController } from './tokens.controller';
import { UsersModule } from '../users/users.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TokenTransaction.name, schema: TokenTransactionSchema },
      { name: PaymentMethodConfig.name, schema: PaymentMethodConfigSchema },
      { name: AdminSettings.name, schema: AdminSettingsSchema },
    ]),
    UsersModule,
    UploadModule,
  ],
  controllers: [TokensController],
  providers: [TokensService, PaymentMethodsService],
  exports: [TokensService, PaymentMethodsService],
})
export class TokensModule {}
