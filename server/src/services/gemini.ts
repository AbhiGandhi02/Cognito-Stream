import {
  GoogleGenerativeAI,
  SchemaType,
  type ResponseSchema,
} from '@google/generative-ai';
import { recordUsage } from './llmUsage';
import {
  MANIM_CODE_SYSTEM_PROMPT,
  CODE_CORRECTION_SYSTEM_PROMPT,
  buildCodeGenPrompt,
  buildCodeCorrectionPrompt,
  type SceneCodeGenParams,
  type CodeCorrectionParams,
} from './prompts';
import { estimateNarrationSeconds } from '../lib/narrationTiming';

// ==========================================
// TYPES
// ==========================================

interface StoryboardScene {
  id: string;
  narration: string;
  visualDescription: string;
  manimOperations: string[];
  estimatedDuration: number;
}

interface StoryboardResponse {
  title: string;
  description: string;
  scenes: StoryboardScene[];
}

// ==========================================
// CONFIGURATION
// ==========================================

// Two Gemini keys, tried in order. PRIMARY is the free-tier key (a project
// with no billing account); SECONDARY is the paid key that takes over when the
// free tier reports a quota / rate-limit error. Legacy GEMINI_API_KEY is
// honored as a primary so existing deploys keep working.
type GeminiKeyTier = 'primary' | 'secondary';

const GEMINI_KEYS: Record<GeminiKeyTier, string> = {
  primary: process.env.GEMINI_API_KEY_PRIMARY || process.env.GEMINI_API_KEY || '',
  secondary: process.env.GEMINI_API_KEY_SECONDARY || '',
};

const GEMINI_CLIENTS: Record<GeminiKeyTier, GoogleGenerativeAI | null> = {
  primary: GEMINI_KEYS.primary ? new GoogleGenerativeAI(GEMINI_KEYS.primary) : null,
  secondary: GEMINI_KEYS.secondary ? new GoogleGenerativeAI(GEMINI_KEYS.secondary) : null,
};

// Two model tiers, because the two jobs are not equally hard.
//
// Writing runnable Manim code is the difficult task and the one that costs
// real money when it goes wrong: a weak model here produces more broken
// scripts, and every repair burns another full 60-90s render. That job keeps
// the stronger flash model.
//
// Scene planning is easy — segment a topic and write narration into a schema
// Gemini enforces server-side. A simpler, faster model is enough, and it is
// one call per video rather than one per scene.
const DEFAULT_TEXT_MODEL = 'gemini-2.5-flash';       // planning and everything else
const DEFAULT_CODE_MODEL = 'gemini-3.7-flash';       // Manim generation + repair

/** Model for scene planning and any non-code call. */
export function textModelName(): string {
  return process.env.GEMINI_MODEL || DEFAULT_TEXT_MODEL;
}

/** Model for writing and repairing Manim code. */
export function codeModelName(): string {
  return process.env.GEMINI_CODE_MODEL || DEFAULT_CODE_MODEL;
}

function envNameFor(tier: GeminiKeyTier): string {
  return tier === 'primary' ? 'GEMINI_API_KEY_PRIMARY' : 'GEMINI_API_KEY_SECONDARY';
}

/** Configured tiers, in failover order. */
function geminiTierOrder(): GeminiKeyTier[] {
  return (['primary', 'secondary'] as GeminiKeyTier[]).filter(
    (t) => GEMINI_CLIENTS[t] !== null
  );
}

// ==========================================
// GEMINI KEY FAILOVER (free primary -> paid secondary)
// ==========================================

interface LLMCallOptions {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  // Override the Gemini model for a single call (e.g. 'gemini-2.5-pro' for code).
  // Falls back to the GEMINI_MODEL env / DEFAULT_TEXT_MODEL.
  geminiModel?: string;
  // Ask the model for a specific response format (e.g. 'application/json').
  responseMimeType?: string;
  // Constrain the response to a schema. Gemini enforces this server-side, so
  // the reply is guaranteed-parseable JSON rather than prose we have to coax
  // into shape. Requires responseMimeType 'application/json'.
  responseSchema?: ResponseSchema;
  // Pin the call to one key tier instead of walking the failover order.
  forceTier?: GeminiKeyTier;
}

// Per-key cooldown. Each key has independent state — a free-tier 429 must not
// lock out the paid key, which was the bug in the previous single-variable
// design. Resets on server restart.
const keyBlockedUntil: Record<GeminiKeyTier, number> = { primary: 0, secondary: 0 };

// Used only when Google gives us no retry hint at all. Short on purpose: the
// common case is a per-minute limit, which resets in ~60s. A long default
// would throw away free-tier quota we are entitled to.
const DEFAULT_QUOTA_COOLDOWN_MS = 60 * 1000;
const MAX_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

function isKeyBlocked(tier: GeminiKeyTier): boolean {
  return Date.now() < keyBlockedUntil[tier];
}

/** Pull the structured error details Google attaches to a 429. */
function errorDetailsOf(err: any): any[] {
  const details =
    err?.errorDetails ??
    err?.response?.data?.error?.details ??
    err?.error?.details;
  return Array.isArray(details) ? details : [];
}

function parseDurationToMs(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(String(value).trim());
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

/**
 * Google returns a google.rpc.RetryInfo on quota errors telling us exactly how
 * long to wait. Honoring it beats guessing — a fixed cooldown either wastes
 * quota (too long) or hammers a wall (too short).
 */
function parseRetryDelayMs(err: any): number | null {
  for (const detail of errorDetailsOf(err)) {
    if (String(detail?.['@type'] || '').includes('RetryInfo') && detail?.retryDelay) {
      const ms = parseDurationToMs(detail.retryDelay);
      if (ms !== null) return ms;
    }
  }
  const retryAfter = err?.response?.headers?.['retry-after'];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.round(seconds * 1000);
  }
  // The SDK sometimes only stringifies the payload into the message.
  const match = /retryDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)s/i.exec(
    String(err?.message || '')
  );
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

/**
 * Per-day quota is a different animal from per-minute: it resets at midnight
 * Pacific, not in 60 seconds. Retrying a exhausted daily quota every minute
 * costs a failed round-trip on every request for the rest of the day.
 */
function isPerDayQuota(err: any): boolean {
  for (const detail of errorDetailsOf(err)) {
    if (String(detail?.['@type'] || '').includes('QuotaFailure')) {
      for (const violation of detail?.violations ?? []) {
        if (/perday/i.test(String(violation?.quotaId || ''))) return true;
      }
    }
  }
  return /per\s?day|daily limit/i.test(String(err?.message || ''));
}

function msUntilPacificMidnight(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = part('hour') % 24; // en-US can emit "24" at midnight
  const elapsed = hour * 3600 + part('minute') * 60 + part('second');
  return Math.max(60_000, (86_400 - elapsed) * 1000);
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** Cool a key down for exactly as long as Google says it needs. */
function blockKeyFromError(tier: GeminiKeyTier, err: unknown): void {
  const perDay = isPerDayQuota(err);
  const retryMs = parseRetryDelayMs(err);

  let ms: number;
  let basis: string;
  if (perDay) {
    ms = msUntilPacificMidnight();
    basis = 'daily quota — until midnight Pacific';
  } else if (retryMs !== null) {
    // +1s so we do not race the window boundary and burn another failure.
    ms = Math.min(retryMs + 1000, MAX_QUOTA_COOLDOWN_MS);
    basis = `RetryInfo ${Math.round(retryMs / 1000)}s`;
  } else {
    ms = DEFAULT_QUOTA_COOLDOWN_MS;
    basis = 'no retry hint — assuming per-minute limit';
  }

  keyBlockedUntil[tier] = Date.now() + ms;
  console.warn(
    `⚠️  [Gemini:${tier}] quota hit — cooling down ${formatDuration(ms)} (${basis}).`
  );
}

type GeminiErrorCategory = 'quota' | 'auth' | 'server' | 'other';

const QUOTA_MESSAGE_PATTERN =
  /resource[_ ](?:has been )?exhausted|rate[ -]?limit|too many requests|quota (?:exceeded|exhausted|metric|limit)|exceeded your current quota|check quota/i;

function categorizeGeminiError(error: any): GeminiErrorCategory {
  const status = error?.status ?? error?.response?.status;
  const message = String(error?.message || '').toLowerCase();

  // Deliberately narrow: this is the branch that spends money by diverting
  // traffic to the paid key. A bare 'exceeded' / 'quota' match also caught
  // token-limit errors ("maxOutputTokens exceeded"), turning a prompt-shape
  // bug into silent paid spend. 429 and RESOURCE_EXHAUSTED are the
  // authoritative signals; the phrases below only cover SDK paths that drop
  // the status code.
  if (status === 429 || QUOTA_MESSAGE_PATTERN.test(message)) {
    return 'quota';
  }
  if (
    status === 401 ||
    status === 403 ||
    message.includes('api_key_invalid') ||
    message.includes('api key not found') ||
    message.includes('permission_denied')
  ) {
    return 'auth';
  }
  if (
    (typeof status === 'number' && status >= 500 && status < 600) ||
    message.includes('service unavailable') ||
    message.includes('high demand') ||
    message.includes('overloaded') ||
    message.includes('try again later')
  ) {
    return 'server';
  }
  return 'other';
}

function isQuotaError(error: any): boolean {
  return categorizeGeminiError(error) === 'quota';
}

async function callGemini(
  opts: LLMCallOptions,
  tier: GeminiKeyTier
): Promise<string> {
  const client = GEMINI_CLIENTS[tier];
  if (!client) {
    throw new Error(`${envNameFor(tier)} not configured`);
  }
  const modelName =
    opts.geminiModel || textModelName();
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: opts.systemPrompt,
    generationConfig: {
      temperature: opts.temperature ?? 0.5,
      maxOutputTokens: opts.maxTokens ?? 4096,
      ...(opts.responseMimeType
        ? { responseMimeType: opts.responseMimeType }
        : {}),
      ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    },
  });
  const result = await model.generateContent(opts.userPrompt);
  recordUsage(modelName, tier, result.response.usageMetadata);
  return result.response.text() || '';
}

/**
 * Convert a Gemini SDK error into a short single-line Error. Avoids dumping
 * the entire request body when a 429 propagates up to orchestrator logs.
 */
function shortProviderError(provider: string, err: unknown): Error {
  const anyErr = err as any;
  const status = anyErr?.response?.status ?? anyErr?.status;
  const apiMessage =
    anyErr?.response?.data?.error?.message ?? anyErr?.error?.error?.message;
  const fallback = String((err as Error)?.message ?? err).slice(0, 200);
  const detail = apiMessage ? String(apiMessage).slice(0, 200) : fallback;
  return new Error(`[${provider}] ${status ?? 'error'} — ${detail}`);
}

/**
 * Run a prompt through the Gemini keys in failover order.
 *
 * primary (free) -> secondary (paid). Only a quota error moves us to the next
 * key: an auth error means a broken key and must surface instead of silently
 * spending money, and a 5xx hits both keys identically so retrying is pointless.
 */
export async function callLLMText(opts: LLMCallOptions): Promise<string> {
  const tiers = opts.forceTier ? [opts.forceTier] : geminiTierOrder();
  if (tiers.length === 0) {
    throw new Error(
      'No Gemini API key configured — set GEMINI_API_KEY_PRIMARY in the env.'
    );
  }

  let lastError: unknown = null;

  for (const tier of tiers) {
    if (isKeyBlocked(tier)) {
      const until = new Date(keyBlockedUntil[tier]).toISOString();
      console.log(`⏭️  [Gemini:${tier}] in cooldown until ${until} — skipping`);
      continue;
    }

    try {
      console.log(`🧠 [Gemini:${tier}] generating...`);
      const text = await callGemini(opts, tier);
      console.log(`✅ [Gemini:${tier}] returned ${text.length} chars`);
      return text;
    } catch (err) {
      lastError = err;
      const category = categorizeGeminiError(err);

      if (category === 'quota') {
        blockKeyFromError(tier, err);
        continue;
      }

      if (category === 'auth') {
        console.error(
          `❌ [Gemini:${tier}] auth failure — verify ${envNameFor(tier)}. ` +
            'Not falling through to the other key: a bad key is a config bug, ' +
            'not a reason to spend.'
        );
      } else if (category === 'server') {
        console.warn(
          `⚠️  [Gemini:${tier}] upstream error (5xx) — the other key hits the ` +
            'same backend, so leaving the retry to the caller.'
        );
      }
      throw shortProviderError(`Gemini:${tier}`, err);
    }
  }

  throw shortProviderError(
    'Gemini',
    lastError ?? new Error('all configured Gemini keys are in cooldown')
  );
}

/**
 * Probe each configured Gemini key with a tiny prompt and report which work,
 * plus the live cooldown state. Used by /api/health/llm — does NOT mutate
 * cooldowns, so a probe never knocks a key out of rotation.
 */
export interface GeminiKeyHealth {
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  sample?: string;
  error?: string;
  quotaError?: boolean;
  inCooldown: boolean;
  cooldownExpiresAt: string | null;
}

export async function pingLLMs(): Promise<Record<GeminiKeyTier, GeminiKeyHealth>> {
  const probe: LLMCallOptions = {
    systemPrompt: 'You are a test bot. Reply with one word.',
    userPrompt: 'Reply with the single word: OK',
    temperature: 0,
    // Not 10: reasoning models spend thinking tokens before emitting text, so
    // a tiny budget returns an empty string and the probe reports a false OK.
    maxTokens: 256,
  };

  const results = {} as Record<GeminiKeyTier, GeminiKeyHealth>;

  for (const tier of ['primary', 'secondary'] as GeminiKeyTier[]) {
    const cooldownExpiresAt =
      keyBlockedUntil[tier] > Date.now()
        ? new Date(keyBlockedUntil[tier]).toISOString()
        : null;

    if (!GEMINI_CLIENTS[tier]) {
      results[tier] = {
        configured: false,
        ok: false,
        latencyMs: 0,
        error: `${envNameFor(tier)} not set`,
        inCooldown: false,
        cooldownExpiresAt: null,
      };
      continue;
    }

    const startedAt = Date.now();
    try {
      const text = await callGemini(probe, tier);
      results[tier] = {
        configured: true,
        ok: true,
        latencyMs: Date.now() - startedAt,
        sample: text.trim().slice(0, 50),
        inCooldown: isKeyBlocked(tier),
        cooldownExpiresAt,
      };
    } catch (err: any) {
      results[tier] = {
        configured: true,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: String(err?.message || err).slice(0, 600),
        quotaError: isQuotaError(err),
        inCooldown: isKeyBlocked(tier),
        cooldownExpiresAt,
      };
    }
  }

  return results;
}

// ==========================================
// MAIN FUNCTION
// ==========================================

// ==========================================
// PROMPT EXPANSION (brief)
// ==========================================

export interface VideoBrief {
  title: string;
  summary: string;
  workedExample: string;
  exampleData: string;
  keyTerms: string[];
  outline: string[];
}

const VIDEO_BRIEF_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    title: {
      type: SchemaType.STRING,
      description: 'Short, specific title for the video. 2-6 words.',
    },
    summary: {
      type: SchemaType.STRING,
      description: 'One sentence describing what the viewer will learn.',
    },
    worked_example: {
      type: SchemaType.STRING,
      description:
        'The single concrete example carried through the whole video, in words. ' +
        'e.g. "bubble-sorting a five-element array of small integers".',
    },
    example_data: {
      type: SchemaType.STRING,
      description:
        'The literal data that example uses, exactly as it should appear on screen. ' +
        'e.g. "[5, 2, 8, 1, 9]" or "f(x) = x^2 on the interval [-2, 2]". ' +
        'Must be concrete values, never a placeholder.',
    },
    key_terms: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Terms and notation to use consistently, 3-6 items.',
    },
    outline: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'What to cover, in teaching order, 4-6 steps.',
    },
  },
  required: [
    'title', 'summary', 'worked_example', 'example_data', 'key_terms', 'outline',
  ],
};

/**
 * Turn a terse prompt into a full brief before any planning happens.
 *
 * "Explain sorting" is three words. Everything downstream — scene planning,
 * then eight independent code-generation calls — has to invent the missing
 * specifics, and each one invents them differently. That is the root cause of
 * the continuity problem: scene 1 picks [5, 2, 8, 1, 9], scene 3 picks
 * [64, 34, 25, 12], and nothing ever reconciles them.
 *
 * Deciding the worked example ONCE, up front, and threading it through the
 * planner means every scene inherits the same concrete data from the start —
 * including scene 1, which has no earlier scenes to copy from.
 *
 * Best-effort by design: a failure here returns null and planning proceeds on
 * the raw prompt exactly as before. An enrichment step must never be able to
 * block video generation.
 */
/**
 * A randomly chosen constraint on the worked example.
 *
 * Asking a model to "pick fresh values" does not work: it has a strong prior
 * and returns its favourite regardless of temperature or a random nonce. A
 * concrete constraint it must satisfy does work, because it rules the default
 * answer out. Each is phrased to degrade gracefully on topics where it does
 * not apply.
 */
const EXAMPLE_VARIATIONS = [
  'Use single-digit values only.',
  'Use two-digit values.',
  'Use a collection of exactly 4 items, if the topic involves a collection.',
  'Use a collection of exactly 6 items, if the topic involves a collection.',
  'Include a repeated or duplicate value, if that is valid for the topic.',
  'Start from a case that is already partly correct or partly ordered.',
  'Start from the worst possible case — maximally unordered, or the hardest input.',
  'Frame the example around a real-world quantity (prices, scores, distances, ages).',
  'Use values that are not round numbers.',
  'Pick a case whose answer is surprising or counter-intuitive at first glance.',
];

function pickVariation(): string {
  return EXAMPLE_VARIATIONS[Math.floor(Math.random() * EXAMPLE_VARIATIONS.length)];
}

export async function expandPrompt(userPrompt: string): Promise<VideoBrief | null> {
  const instruction = `
You are planning an animated educational video from a short user request.
Expand it into a brief the animators can work from without guessing.

The most important field is example_data. Pick ONE concrete worked example and
commit to its literal values — the exact array, equation, or numbers that will
appear on screen. Every scene of the video will animate this same example, so
it must be specific enough to draw and small enough to fit a screen (an array
of about 5 elements, numbers under 100, an equation of a few terms).

Choose an example that makes the idea obvious, not one that merely exercises
it: for a sort, an array whose disorder is visible at a glance.

Pick FRESH values. Do not reach for the textbook default or a set of numbers
you have produced before — vary the actual figures, and where the topic allows
it, vary the framing too (a different quantity being measured, a different
concrete scenario). Two videos on the same topic should not animate the same
numbers. The example must still be the clearest one for the idea; vary the
values, not the quality.

CONSTRAINT FOR THIS REQUEST: ${pickVariation()}
Satisfy it if the topic allows; ignore it silently if it does not apply. It
exists to keep you off your default answer — never mention it to the viewer.

User request: "${userPrompt}"
  `;

  // Retried, unlike the original single-shot version. Scene planning around
  // it retries three times, so a transient 503 that both calls hit would take
  // out the brief while the plan recovered — leaving a video whose scenes each
  // invent their own example, with nothing in the logs to explain why.
  const MAX_BRIEF_ATTEMPTS = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_BRIEF_ATTEMPTS; attempt++) {
  try {
    const text = await callLLMText({
      userPrompt: instruction,
      // Higher than the rest of the pipeline on purpose. This is the one call
      // where variety is the point: it picks the example every scene will
      // animate, and at a low temperature every user asking the same question
      // gets an identical video. Code generation stays cold — there,
      // creativity means invented APIs.
      temperature: 0.9,
      // The brief itself is small (~300 tokens), but THINKING tokens count
      // against this budget too. At 1024 a topic the model reasoned about —
      // the Pythagorean theorem burned 920 on thinking — left too few tokens
      // for the answer and returned truncated JSON. That failed silently,
      // because a failed brief degrades to the raw prompt.
      maxTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: VIDEO_BRIEF_SCHEMA,
    });

    const raw = JSON.parse(text);
    const brief: VideoBrief = {
      title: String(raw.title || '').trim(),
      summary: String(raw.summary || '').trim(),
      workedExample: String(raw.worked_example || '').trim(),
      exampleData: String(raw.example_data || '').trim(),
      keyTerms: Array.isArray(raw.key_terms) ? raw.key_terms.map(String) : [],
      outline: Array.isArray(raw.outline) ? raw.outline.map(String) : [],
    };

    // A brief without concrete data is worse than none — it would add tokens
    // and authority to a vague instruction.
    if (!brief.exampleData || !brief.title) {
      console.warn(
        `⚠️  Prompt expansion returned no concrete example (attempt ${attempt}/${MAX_BRIEF_ATTEMPTS}).`
      );
      lastError = new Error('no concrete example data');
      continue;
    }

    console.log(`📋 Brief: "${brief.title}" — example ${brief.exampleData}`);
    return brief;
  } catch (error) {
    lastError = error;
    const msg = String((error as Error)?.message ?? error).slice(0, 200);
    console.warn(
      `⚠️  Prompt expansion attempt ${attempt}/${MAX_BRIEF_ATTEMPTS} failed (${msg})`
    );
    if (attempt < MAX_BRIEF_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  }

  const msg = String((lastError as Error)?.message ?? lastError).slice(0, 200);
  console.warn(
    `⚠️  Prompt expansion failed after ${MAX_BRIEF_ATTEMPTS} attempts (${msg}) — ` +
    'planning from the raw prompt. Scenes may each pick their own example.'
  );
  return null;
}

/** Render the brief as the block prepended to the planning prompt. */
export function formatBrief(brief: VideoBrief): string {
  const lines = [
    `Title: ${brief.title}`,
    `Goal: ${brief.summary}`,
    `Worked example: ${brief.workedExample}`,
    `EXAMPLE DATA (use these exact values): ${brief.exampleData}`,
  ];
  if (brief.keyTerms.length) {
    lines.push(`Key terms and notation: ${brief.keyTerms.join(', ')}`);
  }
  if (brief.outline.length) {
    lines.push('Cover, in this order:');
    brief.outline.forEach((step, i) => lines.push(`  ${i + 1}. ${step}`));
  }
  return lines.join('\n');
}

/**
 * Response shape for the scene-planning call.
 *
 * Gemini enforces this server-side, which removes an entire class of failure:
 * the planning step used to ask for "raw JSON, no markdown" in prose, then
 * hope, with fence-stripping fallbacks and up to three retries with
 * exponential backoff whenever the model wrapped its answer in ```json or
 * added a sentence of preamble. Constraining the response removes the need to
 * ask, and the retries below now only cover real failures (5xx, truncation).
 *
 * Note: scene_title is requested but not yet persisted — Scene has no title
 * column. Asking for it still improves segmentation (naming a scene forces it
 * to be one coherent unit), but wiring it through to the code-gen brief needs
 * a migration.
 */
const STORYBOARD_SCHEMA: ResponseSchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      scene_title: {
        type: SchemaType.STRING,
        description: 'Short name for what this scene covers.',
      },
      narration: {
        type: SchemaType.STRING,
        description:
          'What the narrator says, 30-70 words. Sets how long the scene runs.',
      },
      visual_description: {
        type: SchemaType.STRING,
        description: 'What the viewer sees animated in this scene.',
      },
    },
    required: ['scene_title', 'narration', 'visual_description'],
  },
};

export async function generateStoryboard(
  prompt: string,
  maxRetries: number = 3
): Promise<StoryboardResponse> {
  console.log('🤖 Generating storyboard with Gemini AI...');
  console.log(`📝 Prompt: "${prompt.substring(0, 100)}..."`);

  // Expand the prompt into a brief FIRST, so the worked example is decided
  // once and inherited by every scene — including scene 1, which has no
  // earlier scenes to copy from. Best-effort: null just means we plan from
  // the raw prompt, exactly as before.
  const brief = await expandPrompt(prompt);

  // The response SHAPE is enforced by STORYBOARD_SCHEMA below, so this prompt
  // says nothing about JSON, keys, or markdown fences — the model cannot
  // return anything else. It only has to get the teaching right.
  const promptForStoryboard = `
You are an expert instructional designer and scriptwriter.
Take the user's idea and turn it into a step-by-step explanatory script,
broken into logical scenes that build understanding in order.
${brief ? `
=== BRIEF (already decided — follow it) ===
${formatBrief(brief)}
=== END BRIEF ===
` : ''}

For each scene:
- scene_title: a short name for what this scene covers.
- narration: what the narrator says — 30 to 70 words. Each scene's animation
  is built to fit its narration, so this length directly sets how long the
  scene runs on screen. Under 30 words is too thin to animate; over 70 makes
  one scene drag and should be split into two.
- visual_description: what the viewer sees animated.

${brief ? `Use the EXAMPLE DATA above in every scene that shows the example — the same
values, in the same order, every time. Write those literal values into the
visual_description of each such scene (e.g. "the array ${brief.exampleData}"),
because each scene's animation is generated independently and the visual
description is what tells it which data to draw. Never substitute a different
example partway through.` : `Introduce one concrete worked example early and carry it through every scene
that needs one, rather than a fresh example each time — the viewer watches
these back-to-back as a single video. Name its literal values in each scene's
visual_description, since scenes are animated independently.`}

User Idea: "${prompt}"
  `;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries}`);

      const responseText = (await callLLMText({
        userPrompt: promptForStoryboard,
        temperature: 0.5,
        maxTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema: STORYBOARD_SCHEMA,
      })).trim();

      if (!responseText) {
        throw new Error('Empty response from LLM');
      }

      console.log('📄 Raw LLM response:', responseText.substring(0, 200));

      // With responseSchema set, Gemini enforces the shape server-side, so
      // this is a straight parse. The fence-stripping fallback is kept only
      // for the case where the configured GEMINI_MODEL does not support
      // structured output and quietly degrades to prose — then this is the
      // difference between a clear error and a confusing one.
      let parsedStoryboard: any;
      try {
        parsedStoryboard = JSON.parse(responseText);
      } catch {
        const fenced = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (!fenced?.[1]) {
          throw new Error(
            `LLM returned non-JSON despite a response schema — check that ` +
            `${textModelName()} supports ` +
            `structured output. Got: ${JSON.stringify(responseText.slice(0, 160))}`
          );
        }
        console.warn('⚠️  Response schema not honored — recovered JSON from a markdown fence.');
        parsedStoryboard = JSON.parse(fenced[1]);
      }

      // The schema pins the root to an array; the object shapes below are
      // tolerated so a hand-edited schema cannot break this silently.
      const scenesArray = Array.isArray(parsedStoryboard)
        ? parsedStoryboard
        : parsedStoryboard?.storyboard || parsedStoryboard?.scenes;

      if (!Array.isArray(scenesArray) || scenesArray.length === 0) {
        throw new Error('LLM did not return a valid storyboard array.');
      }

      // Map SculptAI scene format to Cognito-Stream format
      const storyboard: StoryboardResponse = {
        // The brief gives a real title and a readable summary. Without one we
        // fall back to the old behaviour: the prompt itself, and filler.
        title: brief?.title || prompt.substring(0, 80),
        description: brief?.summary || `Educational animation about: ${prompt}`,
        scenes: scenesArray.map((scene: any, index: number) => {
          const narration = scene.narration || '';
          return {
            id: `scene-${index + 1}`,
            narration,
            visualDescription: scene.visual_description || scene.visualDescription || '',
            manimOperations: [], // Will be generated separately via generateManimSceneCode
            // Derived from how long this narration takes to speak, not a flat
            // constant. The old hardcoded 5 meant a 25-second voiceover was
            // paired with a 7-second animation that then froze for 18 seconds.
            // Replaced by the measured MP3 length once TTS has run.
            estimatedDuration: estimateNarrationSeconds(narration),
          };
        }),
      };

      // Validate the mapped response
      validateStoryboard(storyboard);

      console.log(`✅ Generated ${storyboard.scenes.length} scenes`);
      console.log(`📊 Title: "${storyboard.title}"`);

      return storyboard;

    } catch (error) {
      lastError = error as Error;
      console.error(`❌ Attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to generate storyboard after ${maxRetries} attempts: ${lastError?.message}`
  );
}

// ==========================================
// VALIDATION
// ==========================================

function validateStoryboard(storyboard: any): void {
  if (!storyboard || typeof storyboard !== 'object') {
    throw new Error('Invalid storyboard: not an object');
  }

  if (!storyboard.title || typeof storyboard.title !== 'string') {
    throw new Error('Invalid storyboard: missing or invalid title');
  }

  if (!storyboard.description || typeof storyboard.description !== 'string') {
    throw new Error('Invalid storyboard: missing or invalid description');
  }

  if (!Array.isArray(storyboard.scenes)) {
    throw new Error('Invalid storyboard: scenes must be an array');
  }

  if (storyboard.scenes.length === 0) {
    throw new Error('Invalid storyboard: no scenes generated');
  }

  if (storyboard.scenes.length > 20) {
    throw new Error('Invalid storyboard: too many scenes (max 20)');
  }

  // Validate each scene
  storyboard.scenes.forEach((scene: any, index: number) => {
    if (!scene.id || typeof scene.id !== 'string') {
      throw new Error(`Scene ${index}: missing or invalid id`);
    }

    if (!scene.narration || typeof scene.narration !== 'string') {
      throw new Error(`Scene ${index}: missing or invalid narration`);
    }

    if (scene.narration.length > 1000) {
      throw new Error(`Scene ${index}: narration too long (max 1000 chars)`);
    }

    if (!scene.visualDescription || typeof scene.visualDescription !== 'string') {
      throw new Error(`Scene ${index}: missing or invalid visualDescription`);
    }

    if (
      typeof scene.estimatedDuration !== 'number' ||
      scene.estimatedDuration <= 0
    ) {
      throw new Error(`Scene ${index}: invalid estimatedDuration`);
    }

    // Durations are now derived from narration length, so 20-30s scenes are
    // normal and no longer worth warning about. Flag only the runaway case,
    // which signals a scene that should have been split during planning.
    if (scene.estimatedDuration > 45) {
      console.warn(
        `Scene ${index}: ${scene.estimatedDuration}s is very long — consider splitting this scene`
      );
    }
  });

  console.log('✅ Storyboard validation passed');
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Generate a storyboard with custom configuration
 */
export async function generateStoryboardWithConfig(
  prompt: string,
  config: {
    temperature?: number;
    maxScenes?: number;
    minDuration?: number;
    maxDuration?: number;
  } = {}
): Promise<StoryboardResponse> {
  const customPrompt = `
${prompt}

Additional requirements:
${config.maxScenes ? `- Create no more than ${config.maxScenes} scenes` : ''}
${config.minDuration ? `- Each scene should be at least ${config.minDuration} seconds` : ''}
${config.maxDuration ? `- Each scene should be no more than ${config.maxDuration} seconds` : ''}
  `.trim();

  return generateStoryboard(customPrompt);
}

/**
 * Regenerate a single scene with different parameters
 */
export async function regenerateScene(
  scenePrompt: string,
  sceneNumber: number
): Promise<StoryboardScene> {
  const prompt = `Generate a single scene for an educational video.

Scene requirements:
- Scene number: ${sceneNumber}
- Content: ${scenePrompt}
- Include narration (30-70 words)
- Include visual description
- Include valid Manim operations

Return as JSON with this structure:
{
  "id": "scene-${sceneNumber}",
  "narration": "...",
  "visualDescription": "...",
  "manimOperations": ["..."]
}`;

  const text = await callLLMText({
    userPrompt: prompt,
    temperature: 0.8,
    responseMimeType: 'application/json',
  });

  const scene = JSON.parse(text);
  // Never let the model pick its own duration — it is a function of how long
  // the narration takes to speak, not a stylistic choice.
  scene.estimatedDuration = estimateNarrationSeconds(scene.narration || '');
  return scene;
}

// ==========================================
// MANIM CODE GENERATION (Full Python Code)
// ==========================================

/**
 * Generate a complete Manim Python scene class for a single scene.
 * Returns the raw Python code string.
 */
export async function generateManimSceneCode(
  params: SceneCodeGenParams,
  maxRetries: number = 3
): Promise<string> {
  console.log(`🎨 Generating Manim code for scene ${params.sceneNumber}: "${params.sceneTitle}"`);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Code generation attempt ${attempt}/${maxRetries}`);

      let code = await callLLMText({
        systemPrompt: MANIM_CODE_SYSTEM_PROMPT,
        userPrompt: buildCodeGenPrompt(params),
        // Lower temperature reduces API hallucinations (invented kwargs /
        // method names like get_tangent_line) without costing tokens. Still
        // bump on retries to escape stuck patterns.
        temperature: attempt === 1 ? 0.25 : 0.45,
        // THINKING TOKENS COUNT AGAINST THIS BUDGET. A generated scene is
        // 1,600-2,700 tokens of Python; add several thousand tokens of
        // reasoning and 8192 truncates the file mid-expression. That surfaces
        // as `unmatched ')'` from the renderer's AST check, and the repair
        // loop cannot fix it because repairs shared the same ceiling — so the
        // scene burned all 3 attempts producing successively truncated code.
        // The model stops when it is done, so a high cap costs nothing extra.
        maxTokens: 32768,
        geminiModel: codeModelName(),
      });

      if (!code || code.trim().length === 0) {
        throw new Error('Empty code response from LLM');
      }

      // Strip markdown fences if present
      code = stripMarkdownFences(code);
      code = normalizeManimCode(code);

      // Sanity check — a real Manim scene class is several hundred chars at
      // minimum. If we got back something tiny (e.g. just ")" or a refusal
      // string), skip validateManimCode so we don't surface the misleading
      // "missing class GeneratedScene" cascade. Bail with a clearer error
      // that includes a preview of what actually came back.
      const trimmed = code.trim();
      if (trimmed.length < 200) {
        throw new Error(
          `LLM returned truncated output (${trimmed.length} chars): ${JSON.stringify(trimmed.slice(0, 120))}`
        );
      }

      // Pre-render validation — catch known-bad patterns BEFORE shipping to the
      // renderer. Each finding throws into the existing retry loop, saving a
      // 60-90s Manim round-trip per bad attempt.
      const issues = validateManimCode(code);
      if (issues.length > 0) {
        // Include a head + tail preview so we can see what the LLM actually
        // returned when it skips the required structure. Useful for telling
        // "the model returned prose" from "the model returned JSON" etc.
        const preview =
          code.length <= 240
            ? code
            : `${code.slice(0, 160)} … ${code.slice(-80)}`;
        throw new Error(
          `Pre-render validation failed: ${issues.join('; ')} | preview: ${JSON.stringify(preview)}`
        );
      }

      console.log(`✅ Manim code generated (${code.length} chars)`);
      return code;
    } catch (error) {
      lastError = error as Error;
      // Log message only — stack traces from validation failures are noise.
      console.error(`❌ Code generation attempt ${attempt} failed: ${(error as Error).message}`);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to generate Manim code after ${maxRetries} attempts: ${lastError?.message}`
  );
}

/**
 * Attempt to correct failing Manim code using Gemini.
 * Returns the corrected Python code string.
 */
export async function correctManimCode(
  params: CodeCorrectionParams
): Promise<string> {
  console.log(`🔧 Correcting Manim code (attempt ${params.attemptNumber})...`);

  // Correction prompt is the error-recovery rules ONLY. Including the full
  // code-gen prompt would double the system-prompt size (~6.5k tokens → ~8k
  // tokens) for no benefit — the failing code itself already encodes the
  // constraints, so the model just needs the recovery rules.
  let code = await callLLMText({
    systemPrompt: CODE_CORRECTION_SYSTEM_PROMPT,
    userPrompt: buildCodeCorrectionPrompt(params),
    // Slightly higher temp on later corrections to escape the stuck pattern.
    temperature: params.attemptNumber === 1 ? 0.2 : 0.4,
    // Must match the generation ceiling — a repair returns the WHOLE file, so
    // a lower budget here would truncate the fix for the very scenes most in
    // need of one.
    maxTokens: 32768,
    geminiModel: codeModelName(),
  });

  if (!code || code.trim().length === 0) {
    throw new Error('Empty correction response from LLM');
  }

  // Strip markdown fences if present
  code = stripMarkdownFences(code);
  // Apply every auto-fix transform — same suite the generation path uses.
  code = normalizeManimCode(code);

  if (!code.includes('class GeneratedScene')) {
    throw new Error('Corrected code missing GeneratedScene class');
  }

  console.log(`✅ Code corrected (${code.length} chars)`);
  return code;
}

/**
 * Static validation of generated Manim code. Returns a list of issues; empty
 * list means the code passes. Catches the common LLM mistakes that would
 * otherwise burn a full render cycle to surface.
 */
function validateManimCode(code: string): string[] {
  const issues: string[] = [];

  // Structural requirements
  if (!code.includes('class GeneratedScene')) {
    issues.push("missing 'class GeneratedScene'");
  }
  if (!code.includes('def construct')) {
    issues.push("missing 'def construct' method");
  }
  if (!/from\s+manim\s+import/.test(code)) {
    issues.push("missing 'from manim import ...'");
  }

  // Forbidden import paths (frequent LLM hallucinations)
  if (/from\s+manim\.constants\s+import/.test(code)) {
    issues.push("uses 'from manim.constants import ...' (use 'from manim import ...')");
  }
  if (/from\s+manim\.animation\.rate_functions\s+import/.test(code)) {
    issues.push(
      "uses 'manim.animation.rate_functions' (correct path: 'manim.utils.rate_functions')"
    );
  }

  // Non-existent methods we've seen the LLM invent
  if (/\.get_lines\s*\(/.test(code)) {
    issues.push("'.get_lines()' is not a real Manim method — build Line() objects between vertices instead");
  }
  if (/\.to_center\s*\(/.test(code)) {
    issues.push("'.to_center()' is not a real Mobject method — use '.move_to(ORIGIN)'");
  }
  if (/\bCENTER\b(?!\s*=)/.test(code)) {
    issues.push("'CENTER' is not exported by Manim — use 'ORIGIN'");
  }
  if (/\bSuccessionGroup\b/.test(code)) {
    issues.push("'SuccessionGroup' does not exist in Manim CE — use 'Succession' instead");
  }
  // get_tangent_line is brittle and breaks with various kwargs in CE 0.18.0.
  // Tell the model to build the tangent manually using axes.c2p + slope.
  if (/\.get_tangent_line\s*\(/.test(code)) {
    issues.push("axes.get_tangent_line(...) is unreliable in CE 0.18.0 — build the tangent line manually: take two points along the slope at x_val using axes.c2p() and connect them with Line()");
  }
  // Abstract ArrowTip base class — instantiating it directly raises
  // NotImplementedError. Force a concrete subclass.
  if (/\btip_shape\s*=\s*ArrowTip\b/.test(code)) {
    issues.push("'tip_shape=ArrowTip' instantiates the abstract base class — use 'tip_shape=ArrowTriangleFilledTip' (or another concrete tip)");
  }
  // Hallucinated dash kwargs on shape constructors. The right way to dash a
  // VMobject is to wrap it in DashedVMobject(circle, num_dashes=N). We strip
  // these in normalize, but the validator stays as a safety net.
  const BAD_DASH_KWARGS = [
    'stroke_dash_length',
    'dash_length',
    'stroke_dasharray',
    'stroke_pattern',
    'dash_pattern',
    'dashed',
  ];
  const shapeCtorPattern = /(?:Circle|Line|Square|Rectangle|Polygon|Arc|Ellipse|VMobject)\s*\(/;
  for (const k of BAD_DASH_KWARGS) {
    const re = new RegExp(`${shapeCtorPattern.source}[^)]*\\b${k}\\s*=`);
    if (re.test(code)) {
      issues.push(`'${k}=' is not a valid shape constructor kwarg — wrap the shape in DashedVMobject(shape, num_dashes=N)`);
      break; // one report per scene is enough
    }
  }

  // HTML leakage in strings (Pango/Manim won't render these)
  if (/Text\([^)]*<\/?\w+>/.test(code) || /MathTex\([^)]*<\/?\w+>/.test(code)) {
    issues.push('HTML tag found inside a Text/MathTex string — strip it');
  }

  // Truncation / unbalanced braces (rough heuristic)
  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (Math.abs(openParens - closeParens) > 2) {
    issues.push(
      `unbalanced parentheses (${openParens} '(' vs ${closeParens} ')') — code may be truncated`
    );
  }

  return issues;
}

/**
 * Strip markdown code fences from LLM output.
 */
function stripMarkdownFences(code: string): string {
  // Remove ```python ... ``` wrapping
  code = code.replace(/^```(?:python)?\s*\n?/i, '');
  code = code.replace(/\n?```\s*$/i, '');
  return code.trim();
}

/**
 * Auto-rename any Scene subclass to `GeneratedScene` so the renderer's loader
 * always finds the expected class. The LLM occasionally invents its own name
 * (e.g. `class MyScene(Scene):`) even though the prompt is explicit — instead
 * of burning a retry on that, we just patch it. The parent class is preserved,
 * so `MovingCameraScene`, `ThreeDScene`, etc. still work.
 */
function normalizeSceneClassName(code: string): string {
  return code.replace(
    /class\s+(\w+)\s*\(\s*([A-Z]\w*Scene)\s*\)\s*:/g,
    (full, name: string, parent: string) =>
      name === 'GeneratedScene' ? full : `class GeneratedScene(${parent}):`
  );
}

/**
 * Replace invented method calls with their real Manim equivalents. The LLM
 * sometimes invents methods that sound plausible (`.to_center()`,
 * `.center_on_screen()`) — Manim raises AttributeError at render time.
 */
function patchInventedMethods(code: string): string {
  // `.to_center()` → `.move_to(ORIGIN)`
  code = code.replace(/\.to_center\s*\(\s*\)/g, '.move_to(ORIGIN)');
  // `.center_on_screen()` → `.move_to(ORIGIN)`
  code = code.replace(/\.center_on_screen\s*\(\s*\)/g, '.move_to(ORIGIN)');
  // `SuccessionGroup` doesn't exist in Manim CE — the real class is `Succession`.
  code = code.replace(/\bSuccessionGroup\b/g, 'Succession');
  // Hallucinated submodule: there's no `manim.mobject.svg.special_mobjects`.
  // `Checkmark` isn't a real Mobject — drop the import and rewrite the call.
  code = code.replace(
    /^.*from\s+manim\.mobject\.svg\.special_mobjects\s+import[^\n]*\n?/gm,
    ''
  );
  code = code.replace(/\bCheckmark\s*\(\s*\)/g, 'Text("✓")');
  code = code.replace(/\bCheckmark\s*\(/g, 'Text("✓", ');
  return code;
}

/**
 * Run every auto-fix transform we have on a Manim script. Safe to call on
 * cached code before re-rendering — each transform is idempotent and only
 * rewrites known-broken patterns. Exported so the orchestrator can normalize
 * persisted code on retry, not just fresh LLM output.
 */
export function normalizeManimCode(code: string): string {
  code = normalizeSceneClassName(code);
  code = stripHtmlInTextCalls(code);
  code = stripInvalidDashKwargs(code);
  code = patchInventedMethods(code);
  return code;
}

/**
 * Strip dash-related kwargs that the LLM occasionally passes to shape
 * constructors (Circle / Line / Square / etc). These get forwarded to
 * VMobject.set_stroke() inside Manim and crash with
 *   TypeError: VMobject.set_stroke() got an unexpected keyword argument
 * The correct way to dash a Mobject is `DashedVMobject(shape, num_dashes=N)`.
 * Removing the kwarg falls back to a solid shape — visual fidelity loss is
 * preferable to a hard render failure.
 */
function stripInvalidDashKwargs(code: string): string {
  // Match `, kwarg=value` (including the leading comma + whitespace) OR
  // `kwarg=value,` at the start of an arg list. Limited to the actual
  // dash-related names so we don't touch valid kwargs like `dashed_ratio`
  // on DashedVMobject.
  const names = '(?:stroke_dash_length|dash_length|stroke_dasharray|stroke_pattern|dash_pattern|dashed)';
  return code
    // ", kwarg=value" inside arglist
    .replace(new RegExp(`,\\s*${names}\\s*=\\s*[^,)\\n]+`, 'g'), '')
    // "kwarg=value," when it's the first arg
    .replace(new RegExp(`${names}\\s*=\\s*[^,)\\n]+,\\s*`, 'g'), '');
}

/**
 * Strip HTML tags from Text(...) and MathTex(...) call arguments. Manim's
 * Pango/LaTeX rendering doesn't understand them — they end up either rendered
 * literally or breaking layout. The system prompt forbids them, but the LLM
 * still occasionally emits `<br>`, `<b>`, etc. Rather than failing pre-render
 * validation, we transform the code: <br>/<br/> → `\n`, other tags removed.
 */
function stripHtmlInTextCalls(code: string): string {
  // <br>, <br/>, <br /> → escaped newline first so multi-line text survives.
  code = code.replace(
    /(Text|MathTex)\(([^)]*?)<br\s*\/?>([^)]*?)\)/gi,
    (_m, fn: string, before: string, after: string) => `${fn}(${before}\\n${after})`
  );
  // Remove any remaining `<tag>` / `</tag>` patterns inside Text/MathTex args.
  return code.replace(
    /(Text|MathTex)\(([^)]*)\)/g,
    (_m, fn: string, args: string) => {
      const cleaned = args.replace(/<\/?\w+[^>]*>/g, '');
      return `${fn}(${cleaned})`;
    }
  );
}

// ==========================================
// EXPORT
// ==========================================

export default {
  generateStoryboard,
  generateStoryboardWithConfig,
  regenerateScene,
  generateManimSceneCode,
  correctManimCode,
};