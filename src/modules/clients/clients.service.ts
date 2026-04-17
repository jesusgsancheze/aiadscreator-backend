import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Client, ClientDocument } from './schemas/client.schema';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>,
  ) {}

  async create(
    dto: CreateClientDto,
    userId: string,
    logo?: string | null,
  ): Promise<ClientDocument> {
    const client = new this.clientModel({
      ...dto,
      logo: logo || null,
      userId: new Types.ObjectId(userId),
    });
    return client.save();
  }

  async findAllByUser(userId: string): Promise<ClientDocument[]> {
    return this.clientModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<ClientDocument> {
    const client = await this.clientModel.findById(id).exec();
    if (!client) {
      throw new NotFoundException('Client not found.');
    }
    return client;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateClientDto,
    logo?: string | null,
  ): Promise<ClientDocument> {
    const client = await this.findById(id);
    this.checkOwnership(client, userId);

    const updateData: any = { ...dto };
    if (logo !== undefined) {
      updateData.logo = logo;
    }

    const updated = await this.clientModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .exec();
    return updated!;
  }

  async delete(id: string, userId: string): Promise<void> {
    const client = await this.findById(id);
    this.checkOwnership(client, userId);
    await this.clientModel.findByIdAndDelete(id).exec();
  }

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<{ clients: ClientDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    const [clients, total] = await Promise.all([
      this.clientModel
        .find()
        .populate('userId', 'email firstName lastName')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .exec(),
      this.clientModel.countDocuments().exec(),
    ]);
    return { clients, total };
  }

  private checkOwnership(client: ClientDocument, userId: string): void {
    if (client.userId.toString() !== userId) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }
  }
}
