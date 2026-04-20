export interface ImagePromptGenerationContext {
  copy: string;
  caption: string;
  imageDescription: string;
  socialMedia: string;
  clientName: string;
  preserveProduct?: boolean;
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
- Do NOT include any text or words in the image description${context.preserveProduct ? `

CRITICAL CONSTRAINT: The product, logo, and branding elements from the reference images must be preserved EXACTLY as they appear. Do NOT alter, redesign, or reimagine the product or logo in any way. Only modify the surroundings, background, scene, lighting, and environment around the product. The product/logo must remain pixel-perfect and unmodified. Treat the reference images as sacred — change EVERYTHING around them but NOTHING about them.` : ''}`;

  const userPrompt = `Create a detailed image generation prompt based on the following campaign:

Brand: ${context.clientName}
Platform: ${context.socialMedia}
Ad Copy: ${context.copy}
Caption: ${context.caption}
Image Description from User: ${context.imageDescription}

Generate a detailed, specific prompt for creating a stunning advertising image.`;

  return { systemPrompt, userPrompt };
}
