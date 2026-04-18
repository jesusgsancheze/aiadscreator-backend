import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PaymentMethodConfig,
  PaymentMethodConfigDocument,
} from './schemas/payment-method-config.schema';
import {
  AdminSettings,
  AdminSettingsDocument,
} from './schemas/admin-settings.schema';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';

@Injectable()
export class PaymentMethodsService {
  constructor(
    @InjectModel(PaymentMethodConfig.name)
    private paymentMethodModel: Model<PaymentMethodConfigDocument>,
    @InjectModel(AdminSettings.name)
    private adminSettingsModel: Model<AdminSettingsDocument>,
  ) {}

  async getPaymentMethod(
    type: string,
  ): Promise<PaymentMethodConfigDocument | null> {
    return this.paymentMethodModel.findOne({ type }).exec();
  }

  async getAllPaymentMethods(): Promise<PaymentMethodConfigDocument[]> {
    return this.paymentMethodModel.find().exec();
  }

  async updatePaymentMethod(
    type: string,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodConfigDocument> {
    const update: any = { config: dto.config };
    if (dto.isActive !== undefined) {
      update.isActive = dto.isActive;
    }
    return this.paymentMethodModel
      .findOneAndUpdate({ type }, { $set: update }, { upsert: true, new: true })
      .exec() as Promise<PaymentMethodConfigDocument>;
  }

  async getAdminSettings(
    key: string,
  ): Promise<AdminSettingsDocument | null> {
    return this.adminSettingsModel.findOne({ key }).exec();
  }

  async setAdminSettings(
    key: string,
    value: any,
  ): Promise<AdminSettingsDocument> {
    return this.adminSettingsModel
      .findOneAndUpdate(
        { key },
        { $set: { value } },
        { upsert: true, new: true },
      )
      .exec() as Promise<AdminSettingsDocument>;
  }
}
