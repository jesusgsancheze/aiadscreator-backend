import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { UpdateUserDto } from './dto/update-user.dto';
import { Language } from '../../common/constants';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(data: Partial<User>): Promise<UserDocument> {
    const user = new this.userModel(data);
    return user.save();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findAll(page = 1, limit = 20): Promise<{ users: UserDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.userModel.find().select('-password').skip(skip).limit(limit).exec(),
      this.userModel.countDocuments().exec(),
    ]);
    return { users, total };
  }

  async updateLanguage(userId: string, language: Language): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { language }, { new: true })
      .select('-password')
      .exec();
  }

  async findByVerificationToken(token: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ emailVerificationToken: token }).exec();
  }

  async findByPasswordResetToken(token: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ passwordResetToken: token }).exec();
  }

  async update(userId: string, dto: UpdateUserDto): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, dto, { new: true })
      .select('-password')
      .exec();
  }

  async addTokens(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $inc: { tokenBalance: amount } },
        { new: true },
      )
      .select('-password')
      .exec();
    if (!user) {
      throw new BadRequestException('User not found.');
    }
    return user;
  }

  async deductTokens(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new BadRequestException('User not found.');
    }
    if (user.tokenBalance < amount) {
      throw new BadRequestException(
        `Insufficient tokens. Balance: ${user.tokenBalance}, required: ${amount}.`,
      );
    }
    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $inc: { tokenBalance: -amount } },
        { new: true },
      )
      .select('-password')
      .exec();
    return updated!;
  }

  async getTokenBalance(userId: string): Promise<number> {
    const user = await this.userModel.findById(userId).select('tokenBalance').exec();
    if (!user) {
      throw new BadRequestException('User not found.');
    }
    return user.tokenBalance;
  }
}
