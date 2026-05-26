import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TokensService } from './tokens.service';
import { TokenTransaction } from './schemas/token-transaction.schema';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { PaymentMethodsService } from './payment-methods.service';
import { TransactionStatus, TOKEN_COSTS } from '../../common/constants';

describe('TokensService', () => {
  let service: TokensService;
  let model: any;
  let usersService: jest.Mocked<Partial<UsersService>>;
  let mailService: jest.Mocked<Partial<MailService>>;
  let paymentMethodsService: jest.Mocked<Partial<PaymentMethodsService>>;

  const buildModel = () => {
    const ctor: any = jest.fn().mockImplementation((data: any) => ({
      ...data,
      save: jest.fn().mockResolvedValue({ _id: 'tx-id', ...data }),
    }));
    ctor.find = jest.fn();
    ctor.findOne = jest.fn();
    ctor.findById = jest.fn();
    ctor.countDocuments = jest.fn();
    ctor.aggregate = jest.fn();
    return ctor;
  };

  beforeEach(async () => {
    model = buildModel();
    usersService = {
      getTokenBalance: jest.fn(),
      deductTokens: jest.fn().mockResolvedValue(undefined),
      addTokens: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
    };
    mailService = {
      sendPaymentNotification: jest.fn().mockResolvedValue(undefined),
      sendPaymentResult: jest.fn().mockResolvedValue(undefined),
    };
    paymentMethodsService = {
      getAdminSettings: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: getModelToken(TokenTransaction.name), useValue: model },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
        { provide: PaymentMethodsService, useValue: paymentMethodsService },
      ],
    }).compile();

    service = moduleRef.get(TokensService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Pricing
  // ---------------------------------------------------------------------------
  describe('calculateCampaignCost', () => {
    it('charges copy+caption plus per-image flat fee', () => {
      const cost = service.calculateCampaignCost(3);
      expect(cost.copyCaption).toBe(TOKEN_COSTS.COPY_AND_CAPTION);
      expect(cost.images).toBe(3 * TOKEN_COSTS.PER_IMAGE);
      expect(cost.total).toBe(
        TOKEN_COSTS.COPY_AND_CAPTION + 3 * TOKEN_COSTS.PER_IMAGE,
      );
    });
  });

  describe('canAffordCampaign', () => {
    it('returns canAfford=true when balance covers cost', async () => {
      usersService.getTokenBalance!.mockResolvedValue(500);
      const result = await service.canAffordCampaign('user-id', 2);

      expect(result).toEqual({
        canAfford: true,
        balance: 500,
        cost: TOKEN_COSTS.COPY_AND_CAPTION + 2 * TOKEN_COSTS.PER_IMAGE,
      });
    });

    it('returns canAfford=false when balance is short', async () => {
      usersService.getTokenBalance!.mockResolvedValue(10);
      const result = await service.canAffordCampaign('user-id', 2);

      expect(result.canAfford).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Charging
  // ---------------------------------------------------------------------------
  describe('chargeCampaign', () => {
    it('deducts from the user and writes two approved campaign-spend txns', async () => {
      const userId = new Types.ObjectId().toString();

      await service.chargeCampaign(userId, 2, 'campaign-id', 'claude', 'gemini');

      expect(usersService.deductTokens).toHaveBeenCalledWith(
        userId,
        TOKEN_COSTS.COPY_AND_CAPTION + 2 * TOKEN_COSTS.PER_IMAGE,
      );

      // Two new transactions instantiated.
      expect(model).toHaveBeenCalledTimes(2);
      const [copyArgs, imageArgs] = model.mock.calls.map((c: any[]) => c[0]);

      expect(copyArgs).toMatchObject({
        type: 'campaign_spend',
        tokens: TOKEN_COSTS.COPY_AND_CAPTION,
        status: TransactionStatus.APPROVED,
        aiAgent: 'claude',
      });
      expect(imageArgs).toMatchObject({
        type: 'campaign_spend',
        tokens: 2 * TOKEN_COSTS.PER_IMAGE,
        status: TransactionStatus.APPROVED,
        aiAgent: 'gemini',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Purchase request
  // ---------------------------------------------------------------------------
  describe('createPurchaseRequest', () => {
    it('creates a pending purchase and notifies admins when emails are configured', async () => {
      paymentMethodsService.getAdminSettings!.mockResolvedValue({
        value: ['admin@example.com'],
      } as any);
      usersService.findById!.mockResolvedValue({
        email: 'user@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      } as any);

      const userId = new Types.ObjectId().toString();

      await service.createPurchaseRequest(userId, {
        tokens: 100,
        amountUsd: 10,
        paymentMethod: 'zelle',
      } as any);

      expect(model).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'purchase',
          tokens: 100,
          status: TransactionStatus.PENDING,
        }),
      );
      expect(mailService.sendPaymentNotification).toHaveBeenCalledWith(
        ['admin@example.com'],
        'user@example.com',
        'Ada Lovelace',
        10,
        100,
        'zelle',
      );
    });

    it('skips notification when no admin emails are configured', async () => {
      paymentMethodsService.getAdminSettings!.mockResolvedValue({ value: [] } as any);

      await service.createPurchaseRequest(new Types.ObjectId().toString(), {
        tokens: 100,
        amountUsd: 10,
        paymentMethod: 'zelle',
      } as any);

      expect(mailService.sendPaymentNotification).not.toHaveBeenCalled();
    });

    it('does not let mail failures fail the purchase creation', async () => {
      paymentMethodsService.getAdminSettings!.mockResolvedValue({
        value: ['admin@example.com'],
      } as any);
      usersService.findById!.mockResolvedValue({
        email: 'u@x.com',
        firstName: 'A',
        lastName: 'B',
      } as any);
      mailService.sendPaymentNotification!.mockRejectedValue(new Error('mail down'));

      await expect(
        service.createPurchaseRequest(new Types.ObjectId().toString(), {
          tokens: 50,
          amountUsd: 5,
          paymentMethod: 'binance',
        } as any),
      ).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Upload payment proof
  // ---------------------------------------------------------------------------
  describe('uploadPaymentProof', () => {
    it('throws NotFound when the txn does not belong to the user', async () => {
      model.findOne.mockResolvedValue(null);

      await expect(
        service.uploadPaymentProof('tx-id', new Types.ObjectId().toString(), '/proof.png'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest when the txn has already been reviewed', async () => {
      model.findOne.mockResolvedValue({
        status: TransactionStatus.APPROVED,
      });

      await expect(
        service.uploadPaymentProof('tx-id', new Types.ObjectId().toString(), '/proof.png'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('attaches the proof path and saves', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const tx = { status: TransactionStatus.PENDING, paymentProof: null, save };
      model.findOne.mockResolvedValue(tx);

      const result = await service.uploadPaymentProof(
        'tx',
        new Types.ObjectId().toString(),
        '/proof.png',
      );

      expect(tx.paymentProof).toBe('/proof.png');
      expect(save).toHaveBeenCalledTimes(1);
      expect(result).toBe(tx);
    });
  });

  // ---------------------------------------------------------------------------
  // Review transaction (admin)
  // ---------------------------------------------------------------------------
  describe('reviewTransaction', () => {
    it('throws when the txn is missing', async () => {
      model.findById.mockResolvedValue(null);
      await expect(
        service.reviewTransaction('tx', 'admin', {
          status: TransactionStatus.APPROVED,
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the txn was already reviewed', async () => {
      model.findById.mockResolvedValue({ status: TransactionStatus.APPROVED });

      await expect(
        service.reviewTransaction('tx', 'admin', {
          status: TransactionStatus.APPROVED,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('credits tokens to the user when approving', async () => {
      const userObjId = new Types.ObjectId();
      const save = jest.fn().mockResolvedValue(undefined);
      model.findById.mockResolvedValue({
        status: TransactionStatus.PENDING,
        tokens: 200,
        userId: userObjId,
        save,
      });
      usersService.findById!.mockResolvedValue({
        email: 'u@x.com',
        firstName: 'A',
      } as any);

      await service.reviewTransaction('tx', new Types.ObjectId().toString(), {
        status: TransactionStatus.APPROVED,
      } as any);

      expect(usersService.addTokens).toHaveBeenCalledWith(
        userObjId.toString(),
        200,
      );
      expect(mailService.sendPaymentResult).toHaveBeenCalledWith(
        'u@x.com',
        'A',
        TransactionStatus.APPROVED,
        200,
        undefined,
      );
    });

    it('does NOT credit tokens when rejecting', async () => {
      const userObjId = new Types.ObjectId();
      const save = jest.fn().mockResolvedValue(undefined);
      model.findById.mockResolvedValue({
        status: TransactionStatus.PENDING,
        tokens: 100,
        userId: userObjId,
        save,
      });
      usersService.findById!.mockResolvedValue({ email: 'x', firstName: 'y' } as any);

      await service.reviewTransaction('tx', new Types.ObjectId().toString(), {
        status: TransactionStatus.REJECTED,
        adminNote: 'wrong amount',
      } as any);

      expect(usersService.addTokens).not.toHaveBeenCalled();
    });
  });

  describe('adminGrantTokens', () => {
    it('credits tokens and writes an admin_grant transaction', async () => {
      const adminId = new Types.ObjectId().toString();

      await service.adminGrantTokens(
        {
          userId: new Types.ObjectId().toString(),
          tokens: 500,
          adminNote: 'goodwill',
        } as any,
        adminId,
      );

      expect(usersService.addTokens).toHaveBeenCalled();
      expect(model).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'admin_grant',
          tokens: 500,
          status: TransactionStatus.APPROVED,
          adminNote: 'goodwill',
        }),
      );
    });
  });
});
