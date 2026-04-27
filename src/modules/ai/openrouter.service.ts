import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  CreativeGenerationContext,
  CreativeGenerationResult,
  getCreativeGenerationPrompt,
} from './prompts/creative-generation.prompt';
import {
  GoogleAdsGenerationContext,
  GoogleAdsCreativeResult,
  getGoogleAdsGenerationPrompt,
} from './prompts/google-ads-generation.prompt';
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
      'X-Title': 'ContenidIA',
    };
  }

  // Models that only support image output (no text)
  private readonly imageOnlyModels = [
    'black-forest-labs/flux.2-pro',
    'black-forest-labs/flux.2-max',
    'openai/gpt-5-image',
    'openai/gpt-5-image-mini',
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

  private async chatCompletionJson<T>(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens = 2048,
  ): Promise<T> {
    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
      },
      { headers: this.headers },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No text response from OpenRouter.');
    }

    try {
      return JSON.parse(content) as T;
    } catch {
      // Some models wrap JSON in ```json ... ``` fences or include stray prose.
      // Extract the first balanced {...} block as a fallback.
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error(
          `OpenRouter returned non-JSON content: ${content.slice(0, 200)}`,
        );
      }
      return JSON.parse(match[0]) as T;
    }
  }

  // --- Creative package generation (copy + caption + image prompt in one call) ---

  async generateCreative(
    context: CreativeGenerationContext,
    modelOverride?: string,
  ): Promise<CreativeGenerationResult> {
    const { systemPrompt, userPrompt } = getCreativeGenerationPrompt(context);
    const model = modelOverride || this.textModel;
    const result = await this.chatCompletionJson<CreativeGenerationResult>(
      model,
      systemPrompt,
      userPrompt,
    );

    if (
      typeof result.copy !== 'string' ||
      !result.copy.trim() ||
      typeof result.caption !== 'string' ||
      !result.caption.trim() ||
      typeof result.imagePrompt !== 'string' ||
      !result.imagePrompt.trim() ||
      !result.suggestion ||
      typeof result.suggestion.objective !== 'string' ||
      typeof result.suggestion.dailyBudget !== 'number' ||
      !result.suggestion.targeting ||
      !Array.isArray(result.suggestion.targeting.countries)
    ) {
      throw new Error(
        `OpenRouter creative generation returned an incomplete payload: ${JSON.stringify(result).slice(0, 200)}`,
      );
    }

    // verticalImagePrompt + videoPrompt are only meaningful for meta_full
    // campaigns. Trim when present, drop silently otherwise.
    if (
      typeof result.verticalImagePrompt === 'string' &&
      result.verticalImagePrompt.trim()
    ) {
      result.verticalImagePrompt = result.verticalImagePrompt.trim();
    } else {
      delete (result as Partial<CreativeGenerationResult>).verticalImagePrompt;
    }
    if (
      typeof result.videoPrompt === 'string' &&
      result.videoPrompt.trim()
    ) {
      result.videoPrompt = result.videoPrompt.trim();
    } else {
      delete (result as Partial<CreativeGenerationResult>).videoPrompt;
    }

    // Clamp targeting to Meta's accepted ranges.
    const t = result.suggestion.targeting;
    t.ageMin = Math.max(13, Math.min(65, Math.round(t.ageMin ?? 18)));
    t.ageMax = Math.max(t.ageMin, Math.min(65, Math.round(t.ageMax ?? 65)));
    t.genders = Array.isArray(t.genders)
      ? t.genders.filter((g) => g === 1 || g === 2)
      : [];
    t.countries = t.countries
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));
    if (t.countries.length === 0) t.countries = ['US'];
    t.advantageAudience = Boolean(t.advantageAudience);
    t.interests = Array.isArray(t.interests)
      ? t.interests
          .filter((i): i is string => typeof i === 'string')
          .map((i) => i.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    result.suggestion.dailyBudget = Math.max(1, Math.round(result.suggestion.dailyBudget));

    // Normalize placements block (only present for meta_full campaigns).
    const allowedPublisherPlatforms = [
      'facebook',
      'instagram',
      'messenger',
      'audience_network',
    ];
    const allowedPositionsByPlatform: Record<string, string[]> = {
      facebook: [
        'feed',
        'marketplace',
        'video_feeds',
        'story',
        'instream_video',
        'search',
        'right_hand_column',
      ],
      instagram: ['stream', 'story', 'reels', 'explore', 'explore_home'],
      messenger: ['messenger_home', 'story'],
      audience_network: ['classic', 'rewarded_video'],
    };
    const placements = result.suggestion.placements;
    if (placements) {
      placements.publisherPlatforms = (
        Array.isArray(placements.publisherPlatforms)
          ? placements.publisherPlatforms
          : []
      )
        .filter((p: any): p is string => typeof p === 'string')
        .filter((p) => allowedPublisherPlatforms.includes(p)) as any;
      const filterPositions = (arr: any, platform: string) =>
        Array.isArray(arr)
          ? arr
              .filter((p: any): p is string => typeof p === 'string')
              .filter((p) =>
                allowedPositionsByPlatform[platform].includes(p),
              )
          : [];
      placements.facebookPositions = filterPositions(
        placements.facebookPositions,
        'facebook',
      );
      placements.instagramPositions = filterPositions(
        placements.instagramPositions,
        'instagram',
      );
      placements.messengerPositions = filterPositions(
        placements.messengerPositions,
        'messenger',
      );
      placements.audienceNetworkPositions = filterPositions(
        placements.audienceNetworkPositions,
        'audience_network',
      );
      placements.useAdvantagePlacements = Boolean(
        placements.useAdvantagePlacements,
      );
      // Safety net: if the AI produced an empty platform list, default to FB+IG
      if (placements.publisherPlatforms.length === 0) {
        placements.publisherPlatforms = ['facebook', 'instagram'] as any;
      }
    }

    this.logger.log(`Creative package generated successfully via ${model}`);
    return result;
  }

  // --- Google Ads (Performance Max) creative generation ---

  async generateGoogleAdsCreative(
    context: GoogleAdsGenerationContext,
    modelOverride?: string,
  ): Promise<GoogleAdsCreativeResult> {
    const { systemPrompt, userPrompt } = getGoogleAdsGenerationPrompt(context);
    const model = modelOverride || this.textModel;
    const result = await this.chatCompletionJson<GoogleAdsCreativeResult>(
      model,
      systemPrompt,
      userPrompt,
      3072, // headlines + long headlines + descriptions + suggestion → larger output
    );

    // --- Structural validation ---
    if (
      !Array.isArray(result.headlines) ||
      !Array.isArray(result.longHeadlines) ||
      !Array.isArray(result.descriptions) ||
      typeof result.imagePrompt !== 'string' ||
      typeof result.landscapeImagePrompt !== 'string' ||
      typeof result.businessName !== 'string' ||
      !result.suggestion ||
      typeof result.suggestion.biddingStrategy !== 'string' ||
      typeof result.suggestion.dailyBudget !== 'number'
    ) {
      throw new Error(
        `OpenRouter Google Ads generation returned an incomplete payload: ${JSON.stringify(result).slice(0, 300)}`,
      );
    }

    // --- Enforce length/count caps Google's API requires ---
    result.headlines = this.normalizeStringList(result.headlines, 30, 15, 5);
    result.longHeadlines = this.normalizeStringList(result.longHeadlines, 90, 5, 1);
    result.descriptions = this.normalizeStringList(result.descriptions, 90, 5, 2);
    result.businessName = result.businessName.trim().slice(0, 25);

    if (result.headlines.length < 5) {
      throw new Error(
        `Google Ads generation produced only ${result.headlines.length} valid headlines (minimum 5).`,
      );
    }

    // --- Clamp suggestion fields ---
    const s = result.suggestion;
    s.dailyBudget = Math.max(1, Math.round(s.dailyBudget));

    const allowedBidding = [
      'MAXIMIZE_CONVERSIONS',
      'MAXIMIZE_CONVERSION_VALUE',
      'TARGET_CPA',
      'TARGET_ROAS',
    ];
    if (!allowedBidding.includes(s.biddingStrategy)) {
      s.biddingStrategy = 'MAXIMIZE_CONVERSIONS' as any;
    }
    if (s.biddingStrategy !== 'TARGET_CPA') s.targetCpa = null;
    if (s.biddingStrategy !== 'TARGET_ROAS') s.targetRoas = null;

    // Audience signals
    s.audienceSignals = s.audienceSignals || ({} as any);
    s.audienceSignals.demographics = s.audienceSignals.demographics || {
      ageRanges: [],
      genders: [],
    };
    const allowedAgeRanges = [
      'AGE_RANGE_18_24',
      'AGE_RANGE_25_34',
      'AGE_RANGE_35_44',
      'AGE_RANGE_45_54',
      'AGE_RANGE_55_64',
      'AGE_RANGE_65_UP',
      'AGE_RANGE_UNDETERMINED',
    ];
    s.audienceSignals.demographics.ageRanges = Array.isArray(
      s.audienceSignals.demographics.ageRanges,
    )
      ? s.audienceSignals.demographics.ageRanges.filter((a: any) =>
          allowedAgeRanges.includes(a),
        )
      : [];
    const allowedGenders = ['MALE', 'FEMALE'];
    s.audienceSignals.demographics.genders = Array.isArray(
      s.audienceSignals.demographics.genders,
    )
      ? s.audienceSignals.demographics.genders.filter((g: any) =>
          allowedGenders.includes(g),
        )
      : [];
    s.audienceSignals.interests = this.normalizeStringList(
      s.audienceSignals.interests,
      100,
      7,
      0,
    );
    s.audienceSignals.customSegmentHints = this.normalizeStringList(
      s.audienceSignals.customSegmentHints,
      200,
      4,
      0,
    );

    // Geo / languages
    s.geo = s.geo || { countries: [], regions: [] };
    s.geo.countries = Array.isArray(s.geo.countries)
      ? (s.geo.countries
          .filter((c: any): c is string => typeof c === 'string')
          .map((c: string) => c.trim().toUpperCase())
          .filter((c: string) => /^[A-Z]{2}$/.test(c)) as string[])
      : [];
    if (s.geo.countries.length === 0) s.geo.countries = ['US'];
    s.geo.regions = Array.isArray(s.geo.regions) ? s.geo.regions : [];

    s.languages = Array.isArray(s.languages)
      ? (s.languages
          .filter((l: any): l is string => typeof l === 'string')
          .map((l: string) => l.trim().toLowerCase())
          .filter((l: string) => /^[a-z]{2}$/.test(l)) as string[])
      : [];
    if (s.languages.length === 0) s.languages = ['en'];

    s.finalUrls = Array.isArray(s.finalUrls)
      ? s.finalUrls.filter((u: any): u is string => typeof u === 'string' && u.trim().length > 0)
      : [];

    const allowedCtas = [
      'LEARN_MORE',
      'SHOP_NOW',
      'SIGN_UP',
      'GET_QUOTE',
      'CONTACT_US',
      'DOWNLOAD',
      'BOOK_NOW',
    ];
    if (s.callToAction && !allowedCtas.includes(s.callToAction)) {
      s.callToAction = null;
    }

    s.rationale = typeof s.rationale === 'string' ? s.rationale : '';

    this.logger.log(
      `Google Ads creative generated via ${model} (${result.headlines.length} headlines, ${result.longHeadlines.length} long, ${result.descriptions.length} descriptions)`,
    );
    return result;
  }

  /**
   * Normalizes a free-form string[] from the model into something conforming
   * to a max char length and item count. Drops empty/non-string items,
   * trims whitespace, truncates strings that exceed maxChars.
   */
  private normalizeStringList(
    arr: any,
    maxChars: number,
    maxItems: number,
    minItems: number,
  ): string[] {
    const normalized = (Array.isArray(arr) ? arr : [])
      .filter((s: any): s is string => typeof s === 'string')
      .map((s: string) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => (s.length > maxChars ? s.slice(0, maxChars).trimEnd() : s))
      .slice(0, maxItems);
    if (minItems > 0 && normalized.length < minItems) {
      // Callers decide what to do (throw or pad). Return as-is here.
    }
    return normalized;
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
