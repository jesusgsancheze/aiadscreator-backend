import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ClientsService } from './clients.service';
import { Client } from './schemas/client.schema';

const queryChain = (result: any) => ({
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(result),
});

describe('ClientsService', () => {
  let service: ClientsService;
  let model: any;

  const buildModel = () => {
    const ctor: any = jest.fn().mockImplementation((data: any) => ({
      ...data,
      save: jest.fn().mockResolvedValue({ _id: 'new-client-id', ...data }),
    }));
    ctor.find = jest.fn();
    ctor.findById = jest.fn();
    ctor.findByIdAndUpdate = jest.fn();
    ctor.findByIdAndDelete = jest.fn();
    ctor.countDocuments = jest.fn();
    return ctor;
  };

  beforeEach(async () => {
    model = buildModel();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: getModelToken(Client.name), useValue: model },
      ],
    }).compile();

    service = moduleRef.get(ClientsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('persists a new client with the userId cast to ObjectId', async () => {
      const userId = new Types.ObjectId().toString();

      const result = await service.create(
        { name: 'Acme', description: 'Cool brand' } as any,
        userId,
        'logos/acme.png',
      );

      expect(model).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Acme',
          description: 'Cool brand',
          logo: 'logos/acme.png',
          userId: expect.any(Types.ObjectId),
        }),
      );
      expect(result).toMatchObject({ _id: 'new-client-id', name: 'Acme' });
    });

    it('defaults logo to null when not provided', async () => {
      const userId = new Types.ObjectId().toString();
      await service.create({ name: 'Acme', description: 'x' } as any, userId);

      expect(model).toHaveBeenCalledWith(
        expect.objectContaining({ logo: null }),
      );
    });
  });

  describe('findById', () => {
    it('returns the client when it exists', async () => {
      const doc = { _id: 'id', name: 'Acme' };
      model.findById.mockReturnValue(queryChain(doc));

      await expect(service.findById('id')).resolves.toEqual(doc);
    });

    it('throws NotFound when missing', async () => {
      model.findById.mockReturnValue(queryChain(null));

      await expect(service.findById('id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('rejects updates from non-owners', async () => {
      const ownerId = new Types.ObjectId();
      const intruderId = new Types.ObjectId().toString();
      model.findById.mockReturnValue(
        queryChain({ _id: 'id', userId: ownerId }),
      );

      await expect(
        service.update('id', intruderId, { name: 'X' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('applies the update for the owner', async () => {
      const userId = new Types.ObjectId();
      const updatedDoc = { _id: 'id', name: 'New Name' };
      model.findById.mockReturnValue(
        queryChain({ _id: 'id', userId }),
      );
      model.findByIdAndUpdate.mockReturnValue(queryChain(updatedDoc));

      const result = await service.update(
        'id',
        userId.toString(),
        { name: 'New Name' } as any,
      );

      expect(result).toBe(updatedDoc);
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        'id',
        expect.objectContaining({ name: 'New Name' }),
        { new: true },
      );
    });

    it('only writes a logo field when explicitly passed', async () => {
      const userId = new Types.ObjectId();
      model.findById.mockReturnValue(
        queryChain({ _id: 'id', userId }),
      );
      model.findByIdAndUpdate.mockReturnValue(queryChain({ _id: 'id' }));

      await service.update('id', userId.toString(), { name: 'A' } as any);
      expect(model.findByIdAndUpdate.mock.calls[0][1]).not.toHaveProperty('logo');

      await service.update(
        'id',
        userId.toString(),
        { name: 'A' } as any,
        'new-logo.png',
      );
      expect(model.findByIdAndUpdate.mock.calls[1][1]).toMatchObject({
        logo: 'new-logo.png',
      });
    });
  });

  describe('delete', () => {
    it('rejects when the caller is not the owner', async () => {
      const ownerId = new Types.ObjectId();
      model.findById.mockReturnValue(
        queryChain({ _id: 'id', userId: ownerId }),
      );

      await expect(
        service.delete('id', new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(model.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('removes the doc when the caller owns it', async () => {
      const userId = new Types.ObjectId();
      model.findById.mockReturnValue(
        queryChain({ _id: 'id', userId }),
      );
      model.findByIdAndDelete.mockReturnValue(queryChain(undefined));

      await service.delete('id', userId.toString());
      expect(model.findByIdAndDelete).toHaveBeenCalledWith('id');
    });
  });

  describe('findAllByUser', () => {
    it('queries scoped to the user, sorted by newest first', async () => {
      const userId = new Types.ObjectId().toString();
      const docs = [{ _id: '1' }, { _id: '2' }];
      const chain = queryChain(docs);
      model.find.mockReturnValue(chain);

      const result = await service.findAllByUser(userId);

      expect(model.find).toHaveBeenCalledWith({
        userId: expect.any(Types.ObjectId),
      });
      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(result).toBe(docs);
    });
  });

  describe('findAll (admin paginated)', () => {
    it('returns paginated results with totals', async () => {
      const docs = [{ _id: '1' }];
      model.find.mockReturnValue(queryChain(docs));
      model.countDocuments.mockReturnValue({ exec: () => Promise.resolve(42) });

      const result = await service.findAll(2, 10);

      expect(result).toEqual({ clients: docs, total: 42 });
    });
  });
});
