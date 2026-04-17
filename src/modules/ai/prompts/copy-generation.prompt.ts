export interface CopyGenerationContext {
  socialMedia: string;
  campaignDescription: string;
  clientName: string;
  clientDescription: string;
  language: string;
  topPerformers: Array<{
    copy: string | null;
    caption: string | null;
    performanceScore: number | null;
    socialMedia: string;
  }>;
}

export function getCopyGenerationPrompt(context: CopyGenerationContext): {
  systemPrompt: string;
  userPrompt: string;
} {
  const topPerformersSection =
    context.topPerformers.length > 0
      ? `
Here are the top performing ad copies from previous campaigns for reference (retroactive learning):
${context.topPerformers
  .map(
    (p, i) =>
      `Campaign ${i + 1} (Score: ${p.performanceScore}/10, Platform: ${p.socialMedia}):
  Copy: ${p.copy || 'N/A'}
  Caption: ${p.caption || 'N/A'}`,
  )
  .join('\n')}

Use these successful patterns as inspiration while maintaining originality.`
      : '';

  const systemPrompt = `You are an expert advertising copywriter specializing in social media ads. You create compelling, conversion-focused ad copy that resonates with target audiences.

Your output should be ONLY the ad copy text, without any explanations, labels, or formatting. Just the raw copy text.

Guidelines:
- Write in ${context.language === 'es' ? 'Spanish' : context.language === 'fr' ? 'French' : 'English'}
- Optimize for ${context.socialMedia} platform conventions and character limits
- Focus on benefits, emotional triggers, and clear calls-to-action
- Be concise yet persuasive
${topPerformersSection}`;

  const userPrompt = `Create advertising copy for the following campaign:

Brand/Client: ${context.clientName}
${context.clientDescription ? `Brand Description: ${context.clientDescription}` : ''}
Platform: ${context.socialMedia}
Campaign Description: ${context.campaignDescription}

Write compelling ad copy optimized for ${context.socialMedia}.`;

  return { systemPrompt, userPrompt };
}
