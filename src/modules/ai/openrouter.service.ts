import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  CopyGenerationContext,
  getCopyGenerationPrompt,
} from './prompts/copy-generation.prompt';
import {
  CaptionGenerationContext,
  getCaptionGenerationPrompt,
} from './prompts/caption-generation.prompt';
import {
  ImagePromptGenerationContext,
  getImagePromptGenerationPrompt,
} from './prompts/image-prompt-generation.prompt';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly apiKey: string;
  private readonly textModel: string;
  private readonly imageModel: string;
  private readonly uploadsDir = path.join(process.cwd(), 'uploads');

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY')!;
    this.textModel = this.configService.get<string>(
      'OPENROUTER_TEXT_MODEL',
      'anthropic/claude-sonnet-4',
    );
    this.imageModel = this.configService.get<string>(
      'OPENROUTER_IMAGE_MODEL',
      'google/gemini-2.5-flash-image',
    );

    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aiadscreator.com',
      'X-Title': 'AI Ads Creator',
    };
  }

  // Models that only support image output (no text)
  private readonly imageOnlyModels = [
    'black-forest-labs/flux.2-pro',
    'black-forest-labs/flux.2-max',
    'openai/gpt-5-image',
    'openai/gpt-5-image-mini',
    'sourceful/riverflow-v2',
  ];

  private getImageModalities(model: string): string[] {
    return this.imageOnlyModels.some((m) => model.startsWith(m))
      ? ['image']
      : ['image', 'text'];
  }

  private async chatCompletion(
    model: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 1024,
      },
      { headers: this.headers },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No text response from OpenRouter.');
    }
    return content;
  }

  // --- Text generation (copy, caption, image prompt) ---

  async generateCopy(context: CopyGenerationContext, modelOverride?: string): Promise<string> {
    const { systemPrompt, userPrompt } = getCopyGenerationPrompt(context);
    const model = modelOverride || this.textModel;
    const result = await this.chatCompletion(model, systemPrompt, userPrompt);
    this.logger.log(`Copy generated successfully via ${model}`);
    return result;
  }

  async generateCaption(context: CaptionGenerationContext, modelOverride?: string): Promise<string> {
    const { systemPrompt, userPrompt } = getCaptionGenerationPrompt(context);
    const model = modelOverride || this.textModel;
    const result = await this.chatCompletion(model, systemPrompt, userPrompt);
    this.logger.log(`Caption generated successfully via ${model}`);
    return result;
  }

  async generateImagePrompt(
    context: ImagePromptGenerationContext,
    modelOverride?: string,
  ): Promise<string> {
    const { systemPrompt, userPrompt } =
      getImagePromptGenerationPrompt(context);
    const model = modelOverride || this.textModel;
    const result = await this.chatCompletion(model, systemPrompt, userPrompt);
    this.logger.log(`Image prompt generated successfully via ${model}`);
    return result;
  }

  // --- Text refinement ---

  async refineCopy(
    currentCopy: string,
    instructions: string,
    context: { socialMedia: string; clientName: string; clientDescription: string; campaignDescription: string },
    modelOverride?: string,
  ): Promise<string> {
    const model = modelOverride || this.textModel;
    const systemPrompt = `You are an expert advertising copywriter. You are refining existing advertising copy for ${context.socialMedia}. The client is "${context.clientName}" — ${context.clientDescription}. The campaign is about: ${context.campaignDescription}. Return ONLY the refined copy text, no explanations.`;
    const userPrompt = `Here is the current copy:\n\n${currentCopy}\n\nPlease refine it with these instructions:\n${instructions}`;
    const result = await this.chatCompletion(model, systemPrompt, userPrompt);
    this.logger.log('Copy refined successfully via OpenRouter');
    return result;
  }

  async refineCaption(
    currentCaption: string,
    instructions: string,
    context: { socialMedia: string; clientName: string; clientDescription: string; campaignDescription: string },
    modelOverride?: string,
  ): Promise<string> {
    const model = modelOverride || this.textModel;
    const systemPrompt = `You are an expert social media strategist. You are refining an existing caption for ${context.socialMedia}. The client is "${context.clientName}" — ${context.clientDescription}. The campaign is about: ${context.campaignDescription}. Return ONLY the refined caption text, no explanations.`;
    const userPrompt = `Here is the current caption:\n\n${currentCaption}\n\nPlease refine it with these instructions:\n${instructions}`;
    const result = await this.chatCompletion(model, systemPrompt, userPrompt);
    this.logger.log('Caption refined successfully via OpenRouter');
    return result;
  }

  async generateSingleImage(
    imagePrompt: string,
    variationInstructions: string,
    productImagePaths: string[],
    imageModelOverride?: string,
  ): Promise<string | null> {
    const model = imageModelOverride || this.imageModel;
    try {
      const fullPrompt = `Generate a high-quality, professional advertising image based on this description:\n\n${imagePrompt}\n\nVariation style: ${variationInstructions}`;

      const productImageParts = this.readProductImages(productImagePaths);
      const userContent: any[] = [{ type: 'text', text: fullPrompt }, ...productImageParts];

      const response = await axios.post(
        OPENROUTER_API_URL,
        {
          model,
          messages: [
            {
              role: 'user',
              content: userContent,
            },
          ],
          modalities: this.getImageModalities(model),
          max_tokens: 4096,
        },
        { headers: this.headers },
      );

      const message = response.data?.choices?.[0]?.message;
      if (!message) {
        this.logger.warn('No message in response for single image generation');
        return null;
      }

      if (message.images && Array.isArray(message.images)) {
        for (const img of message.images) {
          const url = img?.image_url?.url;
          if (url) {
            return await this.saveImageFromDataUrl(url, 'single');
          }
        }
      }

      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'image_url' && part.image_url?.url) {
            return await this.saveImageFromDataUrl(part.image_url.url, 'single');
          }
        }
      }

      if (typeof message.content === 'string') {
        const base64Match = message.content.match(
          /data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/,
        );
        if (base64Match) {
          const filename = `${uuidv4()}-single.png`;
          const filePath = path.join(this.uploadsDir, filename);
          fs.writeFileSync(filePath, Buffer.from(base64Match[2], 'base64'));
          return `uploads/${filename}`;
        }
      }

      this.logger.warn('No image data in response for single image generation');
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to generate single image: ${error.response?.data?.error?.message || error.message}`,
      );
      return null;
    }
  }

  // --- Image generation ---

  async generateImages(
    imagePrompt: string,
    productImagePaths: string[],
    imageCount: number = 3,
    imageModelOverride?: string,
  ): Promise<string[]> {
    const variationStyles = [
      'Focus on the product itself. Highlight product details, features, and quality.',
      'Create a lifestyle scene. Show the product being used in a real-life, aspirational context.',
      'Emphasize brand identity. Create a bold, branded visual that communicates the brand values.',
      'Use a minimalist and clean aesthetic with ample white space.',
      'Create a vibrant, colorful composition that grabs attention on social media.',
      'Show the product in a before-and-after or comparison format.',
      'Create a flat lay or overhead arrangement featuring the product.',
      'Use dramatic lighting and shadows for a premium, luxury feel.',
      'Create an infographic-style image highlighting key features or benefits.',
      'Design a seasonal or trending theme that feels timely and relevant.',
    ];

    const count = Math.min(Math.max(imageCount, 1), 10);
    const variations = Array.from({ length: count }, (_, i) => ({
      suffix: variationStyles[i % variationStyles.length],
      name: `variation-${i + 1}`,
    }));

    // Read all product images for reference context
    const productImageParts = this.readProductImages(productImagePaths);
    const model = imageModelOverride || this.imageModel;

    const promises = variations.map(async (variation) => {
      try {
        const fullPrompt = `Generate a high-quality, professional advertising image based on this description:\n\n${imagePrompt}\n\nVariation style: ${variation.suffix}`;

        const userContent: any[] = [{ type: 'text', text: fullPrompt }, ...productImageParts];

        const response = await axios.post(
          OPENROUTER_API_URL,
          {
            model,
            messages: [
              {
                role: 'user',
                content: userContent,
              },
            ],
            modalities: this.getImageModalities(model),
            max_tokens: 4096,
          },
          { headers: this.headers },
        );

        const message = response.data?.choices?.[0]?.message;
        if (!message) {
          this.logger.warn(`No message in response for ${variation.name}`);
          return null;
        }

        // Extract image from message.images array (OpenRouter format)
        if (message.images && Array.isArray(message.images)) {
          for (const img of message.images) {
            const url = img?.image_url?.url;
            if (url) {
              return await this.saveImageFromDataUrl(url, variation.name);
            }
          }
        }

        // Fallback: check content array for image parts
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'image_url' && part.image_url?.url) {
              return await this.saveImageFromDataUrl(part.image_url.url, variation.name);
            }
          }
        }

        // Fallback: check for base64 in text content
        if (typeof message.content === 'string') {
          const base64Match = message.content.match(
            /data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/,
          );
          if (base64Match) {
            const filename = `${uuidv4()}-${variation.name}.png`;
            const filePath = path.join(this.uploadsDir, filename);
            fs.writeFileSync(filePath, Buffer.from(base64Match[2], 'base64'));
            return `uploads/${filename}`;
          }
        }

        this.logger.warn(
          `No image data in response for ${variation.name} variation`,
        );
        return null;
      } catch (error) {
        this.logger.error(
          `Failed to generate ${variation.name} variation: ${error.response?.data?.error?.message || error.message}`,
        );
        return null;
      }
    });

    const results = await Promise.all(promises);
    const generatedPaths = results.filter((r): r is string => r !== null);

    this.logger.log(`Generated ${generatedPaths.length} image variations via OpenRouter`);
    return generatedPaths;
  }

  private readProductImages(productImagePaths: string[]): any[] {
    const parts: any[] = [];
    for (const imagePath of productImagePaths) {
      const absolutePath = path.join(process.cwd(), imagePath);
      if (fs.existsSync(absolutePath)) {
        const imageBuffer = fs.readFileSync(absolutePath);
        const base64 = imageBuffer.toString('base64');
        const ext = path.extname(absolutePath).toLowerCase();
        let mime = 'image/jpeg';
        if (ext === '.png') mime = 'image/png';
        else if (ext === '.webp') mime = 'image/webp';
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${base64}` },
        });
      }
    }
    return parts;
  }

  private async saveImageFromDataUrl(url: string, variationName: string): Promise<string> {
    const filename = `${uuidv4()}-${variationName}.png`;
    const filePath = path.join(this.uploadsDir, filename);

    if (url.startsWith('data:')) {
      const base64Match = url.match(/data:image\/[^;]+;base64,(.+)/);
      if (base64Match) {
        fs.writeFileSync(filePath, Buffer.from(base64Match[1], 'base64'));
        return `uploads/${filename}`;
      }
    }

    // External URL — download it
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(filePath, response.data);
    return `uploads/${filename}`;
  }
}
