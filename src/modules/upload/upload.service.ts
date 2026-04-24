import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;
  private readonly keyPrefix: string;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.required('R2_ACCOUNT_ID');
    const accessKeyId = this.required('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.required('R2_SECRET_ACCESS_KEY');
    this.bucket = this.required('R2_BUCKET');
    this.publicBase = this.required('R2_PUBLIC_URL').replace(/\/+$/, '');
    this.keyPrefix = (this.configService.get<string>('R2_KEY_PREFIX') || 'uploads')
      .replace(/^\/+|\/+$/g, '');

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async saveFile(file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname).toLowerCase();
    const key = `${this.keyPrefix}/${uuidv4()}${ext}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (error: any) {
      this.logger.error(`R2 upload failed for key ${key}: ${error?.message}`, error?.stack);
      throw new InternalServerErrorException('Failed to upload file');
    }

    return `${this.publicBase}/${key}`;
  }

  private required(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Missing required env var: ${key}`);
    }
    return value;
  }
}
