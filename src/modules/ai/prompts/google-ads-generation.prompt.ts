/**
 * AI prompt for Google Ads — Performance Max campaigns.
 *
 * PMax asset groups take pools of text + image assets rather than a single
 * creative. Google's ML rotates headlines, long headlines, descriptions, and
 * images across Search, YouTube, Gmail, Discover, and Display. Our job is
 * to produce enough high-variance, brand-consistent assets that Google's ML
 * has good raw material to mix.
 *
 * This prompt is deliberately separate from the Meta creative prompt — the
 * output shape, length constraints, and asset pool model are too different
 * to share a single prompt cleanly.
 */

export type GoogleAdsBiddingStrategy =
  | 'MAXIMIZE_CONVERSIONS'
  | 'MAXIMIZE_CONVERSION_VALUE'
  | 'TARGET_CPA'
  | 'TARGET_ROAS';

export interface GoogleAdsGenerationContext {
  campaignDescription: string;
  clientName: string;
  clientDescription: string;
  language: string;
  imageDescription: string;
  preserveProduct?: boolean;
  landingUrl?: string;
  topPerformers: Array<{
    copy: string | null;
    caption: string | null;
    performanceScore: number | null;
    socialMedia: string;
  }>;
  googleAdsHistory?: Array<{
    name: string;
    channelType?: string;
    biddingStrategy?: string;
    dailyBudget?: number;
    metrics?: {
      conversions: number;
      costUsd: number;
      ctr: number;
      cpaUsd: number;
      roas: number;
    };
  }>;
}

export interface GoogleAdsCreativeResult {
  headlines: string[]; // 5-15 items, each ≤30 chars
  longHeadlines: string[]; // 1-5 items, each ≤90 chars
  descriptions: string[]; // 2-5 items, each ≤90 chars
  businessName: string; // ≤25 chars, usually client brand name
  imagePrompt: string; // 1:1 square
  landscapeImagePrompt: string; // 1.91:1 landscape
  suggestion: {
    dailyBudget: number;
    biddingStrategy: GoogleAdsBiddingStrategy;
    targetCpa: number | null;
    targetRoas: number | null;
    audienceSignals: {
      demographics: {
        ageRanges: string[]; // Google enum strings e.g. 'AGE_RANGE_18_24'
        genders: string[]; // 'MALE' | 'FEMALE' | [] for no restriction
      };
      interests: string[]; // human-readable Google in-market / affinity segment names
      customSegmentHints: string[]; // free-text hints about the ideal customer
    };
    geo: {
      countries: string[]; // ISO 3166-1 alpha-2
      regions: string[]; // optional, usually empty
    };
    languages: string[]; // ISO 639-1
    finalUrls: string[];
    callToAction: string | null; // Google CTA enum e.g. 'LEARN_MORE'
    rationale: string;
  };
}

export function getGoogleAdsGenerationPrompt(
  context: GoogleAdsGenerationContext,
): { systemPrompt: string; userPrompt: string } {
  const lang =
    context.language === 'es'
      ? 'Spanish'
      : context.language === 'fr'
        ? 'French'
        : 'English';

  const topPerformersSection =
    context.topPerformers.length > 0
      ? `

For tone/voice inspiration, here are past high-performing ads on other platforms (same brand). Don't copy them — translate the winning angle into Google PMax format (shorter, more direct, conversion-oriented):
${context.topPerformers
  .map(
    (p, i) =>
      `${i + 1}. (Score ${p.performanceScore ?? 'N/A'}/10, ${p.socialMedia})
   Copy: ${p.copy || 'N/A'}
   Caption: ${p.caption || 'N/A'}`,
  )
  .join('\n')}`
      : '';

  const googleAdsHistorySection =
    context.googleAdsHistory && context.googleAdsHistory.length > 0
      ? `

The user has the following past Google Ads campaigns. Use these as the PRIMARY signal when choosing suggestion.biddingStrategy, suggestion.dailyBudget, and suggestion.targetCpa/targetRoas — match what has historically converted:
${context.googleAdsHistory
  .map((h, i) => {
    const m = h.metrics;
    const mStr = m
      ? ` | conversions: ${m.conversions}, cost: $${m.costUsd.toFixed(2)}, CTR: ${m.ctr.toFixed(2)}%, CPA: $${m.cpaUsd.toFixed(2)}, ROAS: ${m.roas.toFixed(2)}`
      : '';
    return `${i + 1}. "${h.name}" — channel: ${h.channelType || 'N/A'}, bidding: ${h.biddingStrategy || 'N/A'}, budget: $${h.dailyBudget ?? 'N/A'}${mStr}`;
  })
  .join('\n')}`
      : '';

  const preserveProductSection = context.preserveProduct
    ? `

CRITICAL CONSTRAINT for imagePrompt and landscapeImagePrompt: The product, logo, and branding in the reference images must be preserved EXACTLY as they appear. Describe only the surrounding scene, environment, lighting, and composition — NEVER redesign the product or logo. In the 1.91:1 landscape composition, the product should appear slightly left-of-center so Google's UI chrome doesn't obscure it on the right.`
    : '';

  const systemPrompt = `You are an expert Google Ads account strategist producing an asset pool for a single Performance Max campaign. PMax runs the same assets across Search, YouTube, Gmail, Discover, Display, and Maps — Google's ML mixes and matches them per surface. Your job: produce enough high-variance, brand-consistent assets that Google has rich raw material, plus a calibrated campaign configuration.

You MUST respond with a single JSON object matching this schema exactly, with no markdown, no code fences, and no text outside the JSON:

{
  "headlines": string[],       // 7-15 headlines in ${lang}, each MAX 30 characters. Count characters carefully including spaces. Vary angle: benefit-led, feature-led, question-style, urgency, brand name, social-proof, direct CTA. No two headlines should start with the same word.
  "longHeadlines": string[],   // 3-5 long headlines in ${lang}, each MAX 90 characters. These are used in Discover/Gmail cards where space is generous. Lead with the biggest benefit, include brand name at least once.
  "descriptions": string[],    // 3-5 descriptions in ${lang}, each MAX 90 characters. Supporting text below a headline. Include a clear call-to-action in at least 2 of them.
  "businessName": string,      // MAX 25 characters — usually the client's brand name. Shown beneath headlines on some placements.
  "imagePrompt": string,       // 1:1 square advertising image (1200x1200). Detailed prompt in English: lighting, mood, color palette, composition, style. Do NOT include text in the image.
  "landscapeImagePrompt": string, // 1.91:1 landscape marketing image (1200x628). Same creative concept recomposed horizontally: horizontal leading lines, subject slightly left-of-center (Google's UI often overlays CTA on the right third), keep the horizon line visible. Do NOT include text in the image.
  "suggestion": {
    "dailyBudget": number,     // USD whole units. For new Google accounts without past data, recommend 20-50/day as a learning-phase budget. If past Google history shows higher spend on similar campaigns, match it.
    "biddingStrategy": "MAXIMIZE_CONVERSIONS" | "MAXIMIZE_CONVERSION_VALUE" | "TARGET_CPA" | "TARGET_ROAS",
                                // Default "MAXIMIZE_CONVERSIONS" unless past Google history shows a stable CPA or ROAS to target. Only recommend TARGET_CPA / TARGET_ROAS when you can ground the target in prior performance; never guess a target without data.
    "targetCpa": number | null,  // USD whole units. Populate ONLY if biddingStrategy is TARGET_CPA. Derive from past Google CPA if available, else null.
    "targetRoas": number | null, // Ratio e.g. 4.0 for 400%. Populate ONLY if biddingStrategy is TARGET_ROAS.
    "audienceSignals": {
      "demographics": {
        "ageRanges": string[], // subset of ["AGE_RANGE_18_24","AGE_RANGE_25_34","AGE_RANGE_35_44","AGE_RANGE_45_54","AGE_RANGE_55_64","AGE_RANGE_65_UP","AGE_RANGE_UNDETERMINED"]. [] = no age restriction.
        "genders": string[]    // subset of ["MALE","FEMALE"]. [] = all genders.
      },
      "interests": string[],   // 3-7 mainstream Google in-market / affinity segment names (human-readable, e.g. "Running Shoes","Outdoor Enthusiasts","Home Improvement"). Used as PMax audience SIGNALS (hints, not hard targeting). Do not invent obscure names.
      "customSegmentHints": string[]  // 2-4 short free-text descriptions of the ideal customer in ${lang}. Google turns these into custom segments. Example: "people researching adjustable standing desks" or "homeowners planning a kitchen renovation".
    },
    "geo": {
      "countries": string[],   // ISO 3166-1 alpha-2. Default ["US"] if unclear.
      "regions": string[]      // optional Google geo constant names. Leave [] if country-level is fine.
    },
    "languages": string[],     // ISO 639-1, e.g. ["en"] or ["en","es"]. Match the market.
    "finalUrls": string[],     // The landing URL(s). ${context.landingUrl ? `Use "${context.landingUrl}" as the primary URL.` : 'If no URL is provided, use ["https://example.com"] as a placeholder the user will replace before publish.'}
    "callToAction": "LEARN_MORE" | "SHOP_NOW" | "SIGN_UP" | "GET_QUOTE" | "CONTACT_US" | "DOWNLOAD" | "BOOK_NOW" | null,
                                // Choose the CTA that best fits the campaign intent. null if no strong fit.
    "rationale": string        // 1-2 sentences in ${lang} explaining WHY you chose this bidding strategy, budget, and audience mix. Speak directly to the user. Reference past performance if you grounded the choice in it.
  }
}${preserveProductSection}${googleAdsHistorySection}${topPerformersSection}`;

  const userPrompt = `Produce the Google Performance Max asset pool for this campaign.

Brand: ${context.clientName}
${context.clientDescription ? `Brand description: ${context.clientDescription}` : ''}
Campaign description: ${context.campaignDescription}
User-provided image direction: ${context.imageDescription || '(none)'}
${context.landingUrl ? `Landing URL: ${context.landingUrl}` : ''}

Return only the JSON object.`;

  return { systemPrompt, userPrompt };
}
