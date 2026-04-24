export interface CreativeGenerationContext {
  socialMedia: string;
  campaignDescription: string;
  clientName: string;
  clientDescription: string;
  language: string;
  imageDescription: string;
  preserveProduct?: boolean;
  topPerformers: Array<{
    copy: string | null;
    caption: string | null;
    performanceScore: number | null;
    socialMedia: string;
  }>;
  metaHistory?: Array<{
    name: string;
    objective?: string;
    dailyBudget?: number;
    adsets: Array<{
      optimizationGoal?: string;
      billingEvent?: string;
      targeting: {
        countries?: string[];
        ageMin?: number;
        ageMax?: number;
        genders?: number[];
        advantageAudience?: boolean;
      };
    }>;
    insights?: {
      impressions: number;
      clicks: number;
      spend: number;
      ctr: number;
      cpc: number;
      actions: number;
    };
  }>;
}

export type MetaObjective =
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_SALES';

export type MetaOptimizationGoal =
  | 'REACH'
  | 'IMPRESSIONS'
  | 'LINK_CLICKS'
  | 'LANDING_PAGE_VIEWS'
  | 'POST_ENGAGEMENT'
  | 'OFFSITE_CONVERSIONS'
  | 'LEAD_GENERATION';

export type MetaBillingEvent = 'IMPRESSIONS' | 'LINK_CLICKS';

export type MetaPublisherPlatform =
  | 'facebook'
  | 'instagram'
  | 'messenger'
  | 'audience_network';

export interface CampaignPlacements {
  publisherPlatforms: MetaPublisherPlatform[]; // [] = all
  facebookPositions: string[];
  instagramPositions: string[];
  messengerPositions: string[];
  audienceNetworkPositions: string[];
  useAdvantagePlacements: boolean;
}

export interface CampaignSuggestion {
  objective: MetaObjective;
  dailyBudget: number; // USD, whole units (not cents)
  optimizationGoal: MetaOptimizationGoal;
  billingEvent: MetaBillingEvent;
  targeting: {
    countries: string[]; // ISO 3166-1 alpha-2
    ageMin: number; // 13-65
    ageMax: number; // 13-65
    genders: number[]; // [] = all, [1] = male, [2] = female
    advantageAudience: boolean;
    interests: string[]; // human-readable names, resolved to Meta IDs at publish time
  };
  placements?: CampaignPlacements; // only populated for meta_full campaigns
  rationale: string;
}

export interface CreativeGenerationResult {
  copy: string;
  caption: string;
  imagePrompt: string;
  verticalImagePrompt?: string; // 9:16 companion prompt for meta_full campaigns
  videoPrompt?: string; // Reels/Stories video concept for meta_full campaigns
  suggestion: CampaignSuggestion;
}

export function getCreativeGenerationPrompt(context: CreativeGenerationContext): {
  systemPrompt: string;
  userPrompt: string;
} {
  const lang =
    context.language === 'es'
      ? 'Spanish'
      : context.language === 'fr'
        ? 'French'
        : 'English';

  const isMetaFull = context.socialMedia === 'meta_full';
  const hashtagGuidance = isMetaFull
    ? '3-5'
    : context.socialMedia === 'instagram'
      ? '3-8'
      : context.socialMedia === 'facebook'
        ? '2-4'
        : '3-5';
  const platformLabel = isMetaFull
    ? 'Meta (Facebook + Instagram + Messenger + Audience Network)'
    : context.socialMedia;
  const aspectGuidance = isMetaFull
    ? 'a 1:1 square image (Meta crops and letterboxes this cleanly across Feed, Stories, Reels, Marketplace, and Audience Network)'
    : `an aspect ratio appropriate for ${context.socialMedia}`;

  const topPerformersSection =
    context.topPerformers.length > 0
      ? `

For retroactive learning, here are top-performing past campaigns on the same platform. Use their voice and structure as inspiration while keeping this campaign's output original:
${context.topPerformers
  .map(
    (p, i) =>
      `${i + 1}. (Score ${p.performanceScore ?? 'N/A'}/10, ${p.socialMedia})
   Copy: ${p.copy || 'N/A'}
   Caption: ${p.caption || 'N/A'}`,
  )
  .join('\n')}`
      : '';

  const preserveProductSection = context.preserveProduct
    ? `

CRITICAL CONSTRAINT for imagePrompt: The product, logo, and branding in the reference images must be preserved EXACTLY as they appear. The imagePrompt must describe only the surrounding scene, environment, lighting, and composition — NEVER redesign or reinterpret the product or logo. Treat the reference images as sacred; change everything around them but nothing about them.`
    : '';

  const metaHistorySection =
    context.metaHistory && context.metaHistory.length > 0
      ? `

The user has the following past Meta campaigns on the same ad account (last 90 days, ranked by actual CTR then spend). Treat this as the PRIMARY signal when choosing suggestion.objective, suggestion.dailyBudget, suggestion.optimizationGoal, and suggestion.targeting.* — prefer configurations that have historically performed, and avoid configurations that underperformed. If a past campaign with similar intent did well, mirror its budget/targeting shape. If none fit, fall back to sensible defaults for this brand.
${context.metaHistory
  .map((h, i) => {
    const a = h.adsets[0] || ({} as (typeof h.adsets)[number]);
    const geo = a.targeting?.countries?.join(',') || 'N/A';
    const age =
      a.targeting?.ageMin !== undefined && a.targeting?.ageMax !== undefined
        ? `${a.targeting.ageMin}-${a.targeting.ageMax}`
        : 'N/A';
    const gender =
      !a.targeting?.genders || a.targeting.genders.length === 0
        ? 'all'
        : a.targeting.genders.includes(1) && a.targeting.genders.includes(2)
          ? 'all'
          : a.targeting.genders[0] === 1
            ? 'male'
            : 'female';
    const spend = h.insights ? `$${h.insights.spend.toFixed(2)}` : 'N/A';
    const ctr = h.insights ? `${h.insights.ctr.toFixed(2)}%` : 'N/A';
    const cpc = h.insights ? `$${h.insights.cpc.toFixed(2)}` : 'N/A';
    const actions = h.insights?.actions ?? 0;
    const budget = h.dailyBudget ? `$${h.dailyBudget}` : 'N/A';
    return `${i + 1}. "${h.name}" — objective: ${h.objective || 'N/A'}, daily budget: ${budget}, optimization: ${a.optimizationGoal || 'N/A'}, billing: ${a.billingEvent || 'N/A'}, geo: ${geo}, age: ${age}, gender: ${gender}, advantage+ audience: ${a.targeting?.advantageAudience ? 'yes' : 'no'} | performance: spend ${spend}, CTR ${ctr}, CPC ${cpc}, actions ${actions}`;
  })
  .join('\n')}`
      : '';

  const systemPrompt = `You are an expert advertising director producing a coherent creative package (ad copy, social caption, image generation prompt, and Meta campaign configuration) for a single campaign. All outputs must feel like one cohesive ad — the caption expands on the copy, the image prompt visualizes the same message, and the campaign configuration is tuned to deliver that message to the right audience.${
    isMetaFull
      ? `

This is a MULTI-PLACEMENT Meta campaign. The same creative will run across Feed, Stories, Reels, Marketplace, Messenger, and (optionally) Audience Network. Therefore:
- Copy must read naturally in both long-form (Feed) and short-form (Stories/Reels) contexts. Lead with the hook, keep sentences short, and put the CTA near the start.
- Caption must be Instagram-style (format-strictest placement) but broad enough to work on Facebook Feed.
- Image must be visually striking at 1:1 — Meta will crop center-square for Feed, letterbox for 9:16 Stories/Reels, and scale for Marketplace. Avoid important content in corners.`
      : ''
  }

You MUST respond with a single JSON object matching this schema exactly, with no markdown, no code fences, and no text outside the JSON:

{
  "copy": string,         // ad copy body, written in ${lang}, optimized for ${platformLabel}, focused on benefits, emotional triggers, and a clear call-to-action. Just the raw copy — no labels, no surrounding quotes.
  "caption": string,      // social caption in ${lang} for ${platformLabel} that complements the copy. Include ${hashtagGuidance} relevant hashtags and strategic emojis, plus a call-to-action.
  "imagePrompt": string,  // a detailed English image-generation prompt describing lighting, mood, color palette, composition, and photography style for an advertising-quality image. Specify ${aspectGuidance}. Do NOT include any text or words inside the image.${
    isMetaFull
      ? `
  "verticalImagePrompt": string, // a COMPANION 9:16 vertical recomposition of the same creative, optimized for Stories/Reels. Describe the same scene, subject, brand identity, and mood as imagePrompt, but recomposed for a tall format: place the subject slightly above center, use bold vertical leading lines, leave the top and bottom thirds clean for Meta's chrome (stickers/CTA), and keep any focal detail in the safe center-vertical band. Explicitly state "9:16 vertical aspect ratio". Do NOT include any text or words inside the image.
  "videoPrompt": string, // a Reels/Stories video CONCEPT (6-15 seconds, 9:16 vertical) in plain prose. Describe the opening hook, 2-3 scene beats, camera moves, pacing, and final frame / CTA. Assume the user will either shoot this themselves or feed it to an AI video generator — do not assume a specific provider. Keep it vivid but directable; no text-on-screen unless it's central to the concept.`
      : ''
  }
  "suggestion": {
    "objective": "OUTCOME_ENGAGEMENT" | "OUTCOME_TRAFFIC" | "OUTCOME_AWARENESS" | "OUTCOME_LEADS" | "OUTCOME_SALES",  // the Meta campaign objective that best fits this ad and brand goal.
    "dailyBudget": number,       // suggested daily budget in USD (whole units, e.g. 15). Pick a sensible starting budget for learning phase: 10-30 for most small-business ads, higher only if the campaign description implies scale.
    "optimizationGoal": "REACH" | "IMPRESSIONS" | "LINK_CLICKS" | "LANDING_PAGE_VIEWS" | "POST_ENGAGEMENT" | "OFFSITE_CONVERSIONS" | "LEAD_GENERATION",  // must be compatible with the chosen objective.
    "billingEvent": "IMPRESSIONS" | "LINK_CLICKS",
    "targeting": {
      "countries": string[],     // ISO 3166-1 alpha-2 codes (e.g. ["US", "CA"]). Infer from the brand + campaign; default to ["US"] if truly unclear.
      "ageMin": number,          // integer 13-65
      "ageMax": number,          // integer 13-65, must be >= ageMin
      "genders": number[],       // [] for all, [1] for male-only, [2] for female-only. Default to [] unless the product is clearly gender-specific.
      "advantageAudience": boolean, // Meta's 2026 guidance favors true (broad targeting + AI expansion) for most campaigns. Only set false when very narrow targeting is essential.
      "interests": string[]         // 3-6 specific interest names Meta advertisers can target (e.g. ["Association football (Soccer)", "Running", "Marathon"]). Use recognizable, mainstream interest names — do NOT invent names. Leave empty [] if no clear interests fit.
    },${
      isMetaFull
        ? `
    "placements": {
      "publisherPlatforms": string[], // subset of ["facebook","instagram","messenger","audience_network"]. Default to ["facebook","instagram"] for most brands. Add "messenger" only for conversational/support-style ads. Add "audience_network" only if the brand explicitly tolerates lower-quality third-party inventory; otherwise leave it out.
      "facebookPositions":   string[], // subset of ["feed","marketplace","video_feeds","story","instream_video","search"]. Keep ["feed","marketplace","story"] as the common default.
      "instagramPositions":  string[], // subset of ["stream","story","reels","explore","explore_home"]. "stream" = Feed. Include "reels" for engagement/awareness, skip for heavy-text B2B.
      "messengerPositions":  string[], // subset of ["messenger_home","story"]. Empty if messenger is not in publisherPlatforms.
      "audienceNetworkPositions": string[], // subset of ["classic","rewarded_video"]. Empty if audience_network is not in publisherPlatforms.
      "useAdvantagePlacements": boolean // Meta's recommended 2026 default is true — let Meta auto-distribute across the chosen publisherPlatforms. Set false only if the user's past campaigns show narrow placement targeting worked better, or the brand is format-sensitive.
    },`
        : ''
    }
    "rationale": string          // 1-2 sentences in ${lang} explaining WHY you chose this objective, budget, and audience${isMetaFull ? ', and placement mix' : ''} for this specific campaign. Speak directly to the user. If you grounded the choice in a past Meta campaign, briefly reference what worked ("matches your top-CTR campaign last month").
  }
}${preserveProductSection}${metaHistorySection}${topPerformersSection}`;

  const userPrompt = `Produce the creative package for this campaign.

Brand: ${context.clientName}
${context.clientDescription ? `Brand description: ${context.clientDescription}` : ''}
Platform: ${context.socialMedia}
Campaign description: ${context.campaignDescription}
User-provided image direction: ${context.imageDescription || '(none)'}

Return only the JSON object.`;

  return { systemPrompt, userPrompt };
}
