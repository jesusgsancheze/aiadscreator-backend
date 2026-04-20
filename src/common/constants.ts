export enum Role {
  USER = 'user',
  SUPERADMIN = 'superadmin',
}

export enum SocialMedia {
  INSTAGRAM = 'instagram',
  TIKTOK = 'tiktok',
  FACEBOOK = 'facebook',
  WHATSAPP = 'whatsapp',
  GOOGLE_ADS = 'google_ads',
}

export enum TextAgent {
  CLAUDE = 'claude',
  GROK = 'grok',
}

export enum ImageAgent {
  GEMINI = 'gemini',
  FLUX = 'flux',
  GPT_IMAGE = 'gpt_image',
}

export const TEXT_AGENT_MODELS: Record<TextAgent, string> = {
  [TextAgent.CLAUDE]: 'anthropic/claude-sonnet-4',
  [TextAgent.GROK]: 'x-ai/grok-4-fast',
};

export const IMAGE_AGENT_MODELS: Record<ImageAgent, string> = {
  [ImageAgent.GEMINI]: 'google/gemini-2.5-flash-image',
  [ImageAgent.FLUX]: 'black-forest-labs/flux.2-pro',
  [ImageAgent.GPT_IMAGE]: 'openai/gpt-5-image-mini',
};

export enum CampaignStatus {
  DRAFT = 'draft',
  GENERATING = 'generating',
  READY = 'ready',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

export enum Language {
  EN = 'en',
  ES = 'es',
  FR = 'fr',
}

export enum TransactionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum PaymentMethodType {
  BINANCE = 'binance',
  ZELLE = 'zelle',
  PAGO_MOVIL = 'pago_movil',
}

export const TOKEN_COSTS = {
  COPY_AND_CAPTION: 50,
  PER_IMAGE: 40,
};

export const TOKEN_PACKAGES = [
  { id: 'custom', tokens: 0, price: 0, label: 'Custom' },
  { id: 'starter', tokens: 5500, price: 50, label: '$50 - 5,500 tokens' },
  { id: 'pro', tokens: 11000, price: 100, label: '$100 - 11,000 tokens' },
  {
    id: 'enterprise',
    tokens: 22500,
    price: 200,
    label: '$200 - 22,500 tokens',
  },
];

export const TOKENS_PER_DOLLAR = 100;
