import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CampaignsService } from './campaigns.service';
import { Campaign } from './schemas/campaign.schema';

const queryChain = (result: any) => ({
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(result),
});

const aggregateChain = (result: any) => ({
  exec: jest.fn().mockResolvedValue(result),
});

describe('CampaignsService', () => {
  let service: CampaignsService;
  let model: any;

  const buildModel = () => {
    const ctor: any = jest.fn().mockImplementation((data: any) => ({
      ...data,
      save: jest.fn().mockResolvedValue({ _id: 'new-campaign-id', ...data }),
    }));
    ctor.find = jest.fn();
    ctor.findById = jest.fn();
    ctor.findByIdAndUpdate = jest.fn();
    ctor.findByIdAndDelete = jest.fn();
    ctor.countDocuments = jest.fn();
    ctor.aggregate = jest.fn();
    return ctor;
  };

  beforeEach(async () => {
    model = buildModel();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: getModelToken(Campaign.name), useValue: model },
      ],
    }).compile();

    service = moduleRef.get(CampaignsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('casts clientId + userId to ObjectId and stores productImages', async () => {
      const userId = new Types.ObjectId().toString();
      const clientId = new Types.ObjectId().toString();
      const images = ['products/a.png', 'products/b.png'];

      const result = await service.create(
        { clientId, title: 'Spring drop', socialMedia: 'instagram' } as any,
        userId,
        images,
      );

      expect(model).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Spring drop',
          productImages: images,
          clientId: expect.any(Types.ObjectId),
          userId: expect.any(Types.ObjectId),
        }),
      );
      expect(result._id).toBe('new-campaign-id');
    });
  });

  describe('findById', () => {
    it('populates clientId and returns the doc', async () => {
      const doc = { _id: 'id' };
      const chain = queryChain(doc);
      model.findById.mockReturnValue(chain);

      await expect(service.findById('id')).resolves.toBe(doc);
      expect(chain.populate).toHaveBeenCalledWith(
        'clientId',
        'name logo description',
      );
    });

    it('throws NotFound when missing', async () => {
      model.findById.mockReturnValue(queryChain(null));

      await expect(service.findById('id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findAllByUser', () => {
    it('applies status + socialMedia filters and paginates', async () => {
      const userId = new Types.ObjectId().toString();
      model.find.mockReturnValue(queryChain([{ _id: '1' }]));
      model.countDocuments.mockReturnValue({
        exec: () => Promise.resolve(3),
      });

      const result = await service.findAllByUser(userId, {
        page: 2,
        limit: 5,
        status: 'published',
        socialMedia: 'tiktok',
      });

      expect(model.find).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(Types.ObjectId),
          status: 'published',
          socialMedia: 'tiktok',
        }),
      );
      expect(result).toEqual({ campaigns: [{ _id: '1' }], total: 3 });
    });
  });

  describe('ownership-guarded mutations', () => {
    const ownerId = new Types.ObjectId();

    const stubFindById = (campaign: any = { _id: 'id', userId: ownerId }) => {
      model.findById.mockReturnValue(queryChain(campaign));
    };

    it.each([
      ['update', (s: CampaignsService) => s.update('id', new Types.ObjectId().toString(), { title: 'x' } as any)],
      ['selectImage', (s: CampaignsService) => s.selectImage('id', new Types.ObjectId().toString(), 0)],
      ['selectVerticalImage', (s: CampaignsService) => s.selectVerticalImage('id', new Types.ObjectId().toString(), 0)],
      ['selectVideo', (s: CampaignsService) => s.selectVideo('id', new Types.ObjectId().toString(), 0)],
      ['selectLandscapeImage', (s: CampaignsService) => s.selectLandscapeImage('id', new Types.ObjectId().toString(), 0)],
      ['delete', (s: CampaignsService) => s.delete('id', new Types.ObjectId().toString())],
    ])('%s rejects non-owners with Forbidden', async (_label, action) => {
      stubFindById();
      await expect(action(service)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('selectImage records the chosen index for the owner', async () => {
      stubFindById();
      model.findByIdAndUpdate.mockReturnValue(queryChain({ _id: 'id', selectedImage: 2 }));

      await service.selectImage('id', ownerId.toString(), 2);

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        'id',
        { selectedImage: 2 },
        { new: true },
      );
    });
  });

  describe('updatePerformance', () => {
    it('merges analytics, computes a 1-10 performance score, and stores both', async () => {
      const userId = new Types.ObjectId();
      const existing = {
        _id: 'id',
        userId,
        analytics: { ctr: 1, conversions: 1, engagement: 1, reach: 1 },
      };
      model.findById.mockReturnValue(queryChain(existing));
      // The user's max-values aggregation — match the values we'll pass in so
      // each normalized metric lands at 1.0 and the final score is 10.
      model.aggregate.mockReturnValue(
        aggregateChain([
          {
            maxCtr: 5,
            maxConversions: 5,
            maxEngagement: 5,
            maxReach: 5,
          },
        ]),
      );
      model.findByIdAndUpdate.mockReturnValue(queryChain({ _id: 'id' }));

      await service.updatePerformance('id', userId.toString(), {
        ctr: 5,
        conversions: 5,
        engagement: 5,
        reach: 5,
      } as any);

      const [, payload] = model.findByIdAndUpdate.mock.calls[0];
      expect(payload.performanceScore).toBe(10);
      expect(payload.analytics).toMatchObject({
        ctr: 5,
        conversions: 5,
        engagement: 5,
        reach: 5,
      });
    });

    it('handles a user with no prior campaigns by clamping to the minimum score', async () => {
      const userId = new Types.ObjectId();
      model.findById.mockReturnValue(queryChain({ _id: 'id', userId, analytics: null }));
      model.aggregate.mockReturnValue(aggregateChain([])); // no max yet
      model.findByIdAndUpdate.mockReturnValue(queryChain({ _id: 'id' }));

      await service.updatePerformance('id', userId.toString(), {
        ctr: 0,
        conversions: 0,
        engagement: 0,
        reach: 0,
      } as any);

      const [, payload] = model.findByIdAndUpdate.mock.calls[0];
      // 0 across the board → min score (clamped to 1).
      expect(payload.performanceScore).toBe(1);
    });
  });

  describe('findTopPerforming', () => {
    it('ranks by performanceScore desc and limits to 5', async () => {
      const userId = new Types.ObjectId().toString();
      const chain = queryChain([{ _id: '1' }]);
      model.find.mockReturnValue(chain);

      await service.findTopPerforming(userId);

      expect(model.find).toHaveBeenCalledWith(
        expect.objectContaining({ performanceScore: { $ne: null } }),
      );
      expect(chain.sort).toHaveBeenCalledWith({ performanceScore: -1 });
      expect(chain.limit).toHaveBeenCalledWith(5);
    });
  });
});
