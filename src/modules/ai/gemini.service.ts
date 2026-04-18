import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private genAI: GoogleGenerativeAI;
  private readonly uploadsDir = path.join(process.cwd(), 'uploads');

  constructor(private readonly configService: ConfigService) {
    this.genAI = new GoogleGenerativeAI(
      this.configService.get<string>('GEMINI_API_KEY')!,
    );

    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  async generateImages(
    imagePrompt: string,
    productImagePaths: string[],
  ): Promise<string[]> {
    const variations = [
      {
        suffix: 'Focus on the product itself. Highlight product details, features, and quality.',
        name: 'product-focus',
      },
      {
        suffix: 'Create a lifestyle scene. Show the product being used in a real-life, aspirational context.',
        name: 'lifestyle',
      },
      {
        suffix: 'Emphasize brand identity. Create a bold, branded visual that communicates the brand values.',
        name: 'brand-identity',
      },
    ];

    const generatedPaths: string[] = [];

    // Read all product images for reference
    const productImageInlineParts: any[] = [];
    for (const productImagePath of productImagePaths) {
      const absoluteProductPath = path.join(process.cwd(), productImagePath);
      if (fs.existsSync(absoluteProductPath)) {
        const imageBuffer = fs.readFileSync(absoluteProductPath);
        const productImageData = imageBuffer.toString('base64');
        let productImageMime = 'image/jpeg';
        const ext = path.extname(absoluteProductPath).toLowerCase();
        if (ext === '.png') productImageMime = 'image/png';
        else if (ext === '.webp') productImageMime = 'image/webp';
        productImageInlineParts.push({
          inlineData: {
            mimeType: productImageMime,
            data: productImageData,
          },
        });
      }
    }

    // Generate 3 variations in parallel
    const promises = variations.map(async (variation) => {
      try {
        const fullPrompt = `${imagePrompt}\n\nVariation style: ${variation.suffix}`;

        const model = this.genAI.getGenerativeModel({
          model: 'imagen-3.0-generate-002',
        });

        const parts: any[] = [{ text: fullPrompt }, ...productImageInlineParts];

        const result = await model.generateContent(parts);
        const response = result.response;

        // Try to extract image from response
        const candidates = response.candidates;
        if (candidates && candidates.length > 0) {
          const content = candidates[0].content;
          if (content && content.parts) {
            for (const part of content.parts) {
              if ((part as any).inlineData) {
                const imageData = (part as any).inlineData.data;
                const filename = `${uuidv4()}-${variation.name}.png`;
                const filePath = path.join(this.uploadsDir, filename);
                fs.writeFileSync(filePath, Buffer.from(imageData, 'base64'));
                return `uploads/${filename}`;
              }
            }
          }
        }

        // Fallback: if no image in response, generate a placeholder path
        this.logger.warn(
          `No image data in Gemini response for ${variation.name} variation`,
        );
        return null;
      } catch (error) {
        this.logger.error(
          `Failed to generate ${variation.name} variation: ${error.message}`,
        );
        return null;
      }
    });

    const results = await Promise.all(promises);
    for (const result of results) {
      if (result) {
        generatedPaths.push(result);
      }
    }

    this.logger.log(`Generated ${generatedPaths.length} image variations`);
    return generatedPaths;
  }
}
