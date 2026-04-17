import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
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

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private client: Anthropic;

  constructor(private readonly configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async generateCopy(context: CopyGenerationContext): Promise<string> {
    const { systemPrompt, userPrompt } = getCopyGenerationPrompt(context);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude for copy generation.');
    }
    this.logger.log('Copy generated successfully');
    return textBlock.text;
  }

  async generateCaption(context: CaptionGenerationContext): Promise<string> {
    const { systemPrompt, userPrompt } = getCaptionGenerationPrompt(context);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude for caption generation.');
    }
    this.logger.log('Caption generated successfully');
    return textBlock.text;
  }

  async generateImagePrompt(
    context: ImagePromptGenerationContext,
  ): Promise<string> {
    const { systemPrompt, userPrompt } =
      getImagePromptGenerationPrompt(context);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error(
        'No text response from Claude for image prompt generation.',
      );
    }
    this.logger.log('Image prompt generated successfully');
    return textBlock.text;
  }
}
