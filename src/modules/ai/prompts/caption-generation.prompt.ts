export interface CaptionGenerationContext {
  socialMedia: string;
  campaignDescription: string;
  clientName: string;
  clientDescription: string;
  language: string;
  copy: string;
  topPerformers: Array<{
    copy: string | null;
    caption: string | null;
    performanceScore: number | null;
    socialMedia: string;
  }>;
}

export function getCaptionGenerationPrompt(context: CaptionGenerationContext): {
  systemPrompt: string;
  userPrompt: string;
} {
  const topPerformersSection =
    context.topPerformers.length > 0
      ? `
Here are captions from top performing campaigns for reference:
${context.topPerformers
  .map(
    (p, i) =>
      `Campaign ${i + 1} (Score: ${p.performanceScore}/10):
  Caption: ${p.caption || 'N/A'}`,
  )
  .join('\n')}

Learn from these successful patterns.`
      : '';

  const systemPrompt = `You are a social media expert specializing in creating engaging captions that drive engagement and conversions.

Your output should be ONLY the caption text, including relevant hashtags and emojis where appropriate. No explanations or labels.

Guidelines:
- Write in ${context.language === 'es' ? 'Spanish' : context.language === 'fr' ? 'French' : 'English'}
- Optimize for ${context.socialMedia} platform
- Include relevant hashtags (3-8 for Instagram, 2-4 for Facebook, 3-5 for TikTok)
- Use emojis strategically
- Include a call-to-action
${topPerformersSection}`;

  const userPrompt = `Create a social media caption for the following:

Brand: ${context.clientName}
Platform: ${context.socialMedia}
Campaign: ${context.campaignDescription}
Ad Copy: ${context.copy}

Write an engaging ${context.socialMedia} caption that complements the ad copy.`;

  return { systemPrompt, userPrompt };
}
