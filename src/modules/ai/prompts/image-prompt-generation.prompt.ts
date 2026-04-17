export interface ImagePromptGenerationContext {
  copy: string;
  caption: string;
  imageDescription: string;
  socialMedia: string;
  clientName: string;
}

export function getImagePromptGenerationPrompt(
  context: ImagePromptGenerationContext,
): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = `You are an expert at creating detailed image generation prompts for AI image generators. You translate advertising concepts into vivid, specific visual descriptions.

Your output should be ONLY the image generation prompt text. No explanations, labels, or formatting. Just the raw prompt.

Guidelines:
- Be extremely detailed and specific about visual elements
- Include lighting, mood, color palette, composition, and style
- Specify the aspect ratio appropriate for ${context.socialMedia}
- Focus on commercial/advertising quality imagery
- Include photography style references when appropriate
- Do NOT include any text or words in the image description`;

  const userPrompt = `Create a detailed image generation prompt based on the following campaign:

Brand: ${context.clientName}
Platform: ${context.socialMedia}
Ad Copy: ${context.copy}
Caption: ${context.caption}
Image Description from User: ${context.imageDescription}

Generate a detailed, specific prompt for creating a stunning advertising image.`;

  return { systemPrompt, userPrompt };
}
