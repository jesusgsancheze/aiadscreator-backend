import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MetaConnection,
  MetaConnectionDocument,
} from './schemas/meta-connection.schema';
import { CreateMetaConnectionDto } from './dto/create-meta-connection.dto';
import { UpdateMetaConnectionDto } from './dto/update-meta-connection.dto';
import { MetaService } from './meta.service';

@Injectable()
export class MetaConnectionService {
  private readonly logger = new Logger(MetaConnectionService.name);

  constructor(
    @InjectModel(MetaConnection.name)
    private readonly metaConnectionModel: Model<MetaConnectionDocument>,
    private readonly metaService: MetaService,
  ) {}

  async create(
    userId: string,
    dto: CreateMetaConnectionDto,
  ): Promise<MetaConnectionDocument> {
    // Verify the connection before saving
    const verification = await this.metaService.verifyConnection(
      dto.accessToken,
      dto.adAccountId,
    );

    if (!verification.valid) {
      throw new BadRequestException(
        `Meta ad account is not active. Account: ${verification.accountName}`,
      );
    }

    try {
      const connection = await this.metaConnectionModel.create({
        userId: new Types.ObjectId(userId),
        clientId: new Types.ObjectId(dto.clientId),
        accessToken: dto.accessToken,
        adAccountId: dto.adAccountId,
        pageId: dto.pageId,
        instagramAccountId: dto.instagramAccountId || null,
        isActive: true,
        lastVerified: new Date(),
      });

      this.logger.log(
        `Meta connection created for user ${userId}, client ${dto.clientId}`,
      );
      return connection;
    } catch (error) {
      if (error.code === 11000) {
        throw new BadRequestException(
          'A Meta connection already exists for this user and client',
        );
      }
      throw error;
    }
  }

  async findByUserAndClient(
    userId: string,
    clientId: string,
  ): Promise<MetaConnectionDocument> {
    const connection = await this.metaConnectionModel.findOne({
      userId: new Types.ObjectId(userId),
      clientId: new Types.ObjectId(clientId),
      isActive: true,
    });

    if (!connection) {
      throw new NotFoundException(
        `No active Meta connection found for client ${clientId}`,
      );
    }

    return connection;
  }

  async findAllByUser(userId: string): Promise<MetaConnectionDocument[]> {
    return this.metaConnectionModel.find({
      userId: new Types.ObjectId(userId),
      isActive: true,
    });
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateMetaConnectionDto,
  ): Promise<MetaConnectionDocument> {
    const connection = await this.metaConnectionModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });

    if (!connection) {
      throw new NotFoundException(`Meta connection not found`);
    }

    // Re-verify if the access token changed
    if (dto.accessToken) {
      const adAccountId = dto.adAccountId || connection.adAccountId;
      const verification = await this.metaService.verifyConnection(
        dto.accessToken,
        adAccountId,
      );

      if (!verification.valid) {
        throw new BadRequestException(
          `Meta ad account is not active. Account: ${verification.accountName}`,
        );
      }

      connection.lastVerified = new Date();
    }

    Object.assign(connection, dto);
    await connection.save();

    this.logger.log(`Meta connection ${id} updated`);
    return connection;
  }

  async delete(id: string, userId: string): Promise<MetaConnectionDocument> {
    const connection = await this.metaConnectionModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });

    if (!connection) {
      throw new NotFoundException(`Meta connection not found`);
    }

    connection.isActive = false;
    await connection.save();

    this.logger.log(`Meta connection ${id} soft-deleted`);
    return connection;
  }

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<{
    data: MetaConnectionDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.metaConnectionModel
        .find()
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      this.metaConnectionModel.countDocuments(),
    ]);

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<MetaConnectionDocument> {
    const connection = await this.metaConnectionModel.findById(id);
    if (!connection) {
      throw new NotFoundException(`Meta connection not found`);
    }
    return connection;
  }
}
