// ==========================================
// USER-FACING ERROR MAPPING
// server/src/services/userFacingError.ts
// ==========================================
//
// Provider errors are written verbatim into Scene.errorMessage / Storyboard.
// errorMessage so admins and logs keep the full detail. They must NOT reach an
// end user: a raw Gemini 429 leaks the provider, model name and key tier, is
// unreadable, and tells the viewer to "check your plan and billing details" —
// which is our billing, not theirs.
//
// This module turns a stored raw message into something a user can act on.
// Admin routes intentionally skip it and return the raw string.

export type UserErrorCode =
  | 'capacity'      // provider rate/quota limit — ours, not the user's
  | 'upstream'      // provider 5xx
  | 'config'        // our API key / setup is broken
  | 'content'       // the model refused or returned unusable output
  | 'timeout'
  | 'render'        // Manim/renderer failure
  | 'interrupted'   // server restarted mid-job
  | 'unknown';

export interface UserFacingError {
  code: UserErrorCode;
  /** Short headline for the cause, e.g. "AI service overloaded". */
  reason: string;
  /** Safe to show to any user. */
  message: string;
  /** HTTP status an API response for this error should carry. */
  status: number;
  /** True when trying again later is likely to work. */
  retryable: boolean;
}

// Status codes are matched only when they stand alone ("] 503 —", "[503 ]",
// "status code 502"). A plain \b5\d{2}\b also hit source positions in stack
// text — a Prisma error at "storyboard.ts:553:48" was reported to users as an
// AI overload, with a 503.
const RULES: Array<{
  code: UserErrorCode;
  test: RegExp;
  reason: string;
  message: string;
  status: number;
  retryable: boolean;
}> = [
  {
    code: 'capacity',
    // Matches our own quota wording plus Google's ("exceeded your current
    // quota", RESOURCE_EXHAUSTED, 429).
    test: /(?<![\w:.])429(?![\w:.])|resource[_ ](?:has been )?exhausted|quota|rate[ -]?limit|too many requests|cool(?:ing down|down)/i,
    reason: 'AI usage limit reached',
    message:
      'We’ve hit our AI capacity limit for the moment. Your work is saved — please try again in a few minutes.',
    status: 429,
    retryable: true,
  },
  {
    code: 'upstream',
    test: /(?<![\w:.])5\d{2}(?![\w:.])|high demand|overloaded|service unavailable|try again later|unavailable/i,
    reason: 'AI service overloaded',
    message:
      'The AI service is temporarily overloaded. Your work is saved — please try again in a moment.',
    status: 503,
    retryable: true,
  },
  {
    code: 'config',
    // An auth failure is our misconfiguration; never blame or expose it.
    test: /(?<![\w:.])40[13](?![\w:.])|api[_ ]key|unauthenticated|permission[_ ]denied|not configured|invalid authentication/i,
    reason: 'Server configuration problem',
    message:
      'Something is misconfigured on our side and the team has been notified. Please try again later.',
    status: 500,
    retryable: false,
  },
  {
    code: 'timeout',
    test: /timeout|timed out|ETIMEDOUT|ECONNRESET|socket hang up/i,
    reason: 'Request timed out',
    message: 'That took too long to complete. Please try again.',
    status: 504,
    retryable: true,
  },
  {
    code: 'render',
    test: /manim|render(er)?\b|ffmpeg|latex|GeneratedScene|validation failed/i,
    reason: 'Animation render failed',
    message:
      'We couldn’t render this scene’s animation. Try regenerating it, or tweak the scene description.',
    status: 500,
    retryable: true,
  },
  {
    code: 'content',
    test: /safety|blocked|refus|empty (code|correction)?\s*response|truncated output/i,
    reason: 'AI response unusable',
    message:
      'The AI couldn’t produce a usable animation for this scene. Try rewording the scene description.',
    status: 502,
    retryable: true,
  },
  {
    code: 'interrupted',
    test: /interrupted by a server restart/i,
    reason: 'Generation interrupted',
    message: 'Our server restarted while this was in progress. Please try again.',
    status: 503,
    retryable: true,
  },
];

const FALLBACK: UserFacingError = {
  code: 'unknown',
  reason: 'Unexpected server error',
  message: 'Something went wrong generating this scene. Please try again.',
  status: 500,
  retryable: true,
};

/**
 * Classify a raw internal error message. Order matters — capacity and upstream
 * are checked before the broader render/content rules so a provider 429 that
 * happens to mention Manim is still reported as capacity.
 */
export function classifyUserError(raw: unknown): UserFacingError {
  const text =
    raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : String(raw ?? '');
  if (!text.trim()) return FALLBACK;

  for (const rule of RULES) {
    if (rule.test.test(text)) {
      const { test: _test, ...error } = rule;
      return error;
    }
  }
  return FALLBACK;
}

const USER_MESSAGES = new Set([...RULES.map((r) => r.message), FALLBACK.message]);

/**
 * True when text is already one of our user-facing messages. Re-classifying
 * those is lossy: "…try again in a few minutes" matches no rule and would
 * collapse into the generic fallback.
 */
export function isUserFacingMessage(text: string): boolean {
  return USER_MESSAGES.has(text);
}

/**
 * Map a stored errorMessage to user-safe text. Returns null/undefined
 * unchanged so "no error" stays "no error".
 */
export function toUserMessage<T extends string | null | undefined>(
  raw: T
): T extends string ? string : T {
  if (raw === null || raw === undefined || raw === '') return raw as never;
  return classifyUserError(raw).message as never;
}

/** Replace errorMessage on a scene-shaped object with user-safe text. */
export function sanitizeScene<T extends { errorMessage?: string | null }>(scene: T): T {
  if (!scene?.errorMessage) return scene;
  return { ...scene, errorMessage: toUserMessage(scene.errorMessage) };
}

/**
 * Replace errorMessage on a storyboard and every nested scene. Use at every
 * response boundary that returns storyboard data to a non-admin user.
 */
export function sanitizeStoryboard<
  T extends { errorMessage?: string | null; scenes?: Array<{ errorMessage?: string | null }> }
>(storyboard: T): T {
  if (!storyboard) return storyboard;
  return {
    ...storyboard,
    ...(storyboard.errorMessage
      ? { errorMessage: toUserMessage(storyboard.errorMessage) }
      : {}),
    ...(Array.isArray(storyboard.scenes)
      ? { scenes: storyboard.scenes.map(sanitizeScene) }
      : {}),
  };
}
