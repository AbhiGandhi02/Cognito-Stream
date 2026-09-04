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
  | 'unknown';

export interface UserFacingError {
  code: UserErrorCode;
  /** Safe to show to any user. */
  message: string;
  /** True when trying again later is likely to work. */
  retryable: boolean;
}

const RULES: Array<{ code: UserErrorCode; test: RegExp; message: string; retryable: boolean }> = [
  {
    code: 'capacity',
    // Matches our own quota wording plus Google's ("exceeded your current
    // quota", RESOURCE_EXHAUSTED, 429).
    test: /\b429\b|resource[_ ](?:has been )?exhausted|quota|rate[ -]?limit|too many requests|cool(?:ing down|down)/i,
    message:
      'We’ve hit our AI capacity limit for the moment. Your work is saved — please try again in a few minutes.',
    retryable: true,
  },
  {
    code: 'upstream',
    test: /\b5\d{2}\b|high demand|overloaded|service unavailable|try again later|unavailable/i,
    message:
      'The AI service is temporarily overloaded. Your work is saved — please try again in a moment.',
    retryable: true,
  },
  {
    code: 'config',
    // An auth failure is our misconfiguration; never blame or expose it.
    test: /\b40[13]\b|api[_ ]key|unauthenticated|permission[_ ]denied|not configured|invalid authentication/i,
    message:
      'Something is misconfigured on our side and the team has been notified. Please try again later.',
    retryable: false,
  },
  {
    code: 'timeout',
    test: /timeout|timed out|ETIMEDOUT|ECONNRESET|socket hang up/i,
    message: 'That took too long to complete. Please try again.',
    retryable: true,
  },
  {
    code: 'render',
    test: /manim|render(er)?\b|ffmpeg|latex|GeneratedScene|validation failed/i,
    message:
      'We couldn’t render this scene’s animation. Try regenerating it, or tweak the scene description.',
    retryable: true,
  },
  {
    code: 'content',
    test: /safety|blocked|refus|empty (code|correction)?\s*response|truncated output/i,
    message:
      'The AI couldn’t produce a usable animation for this scene. Try rewording the scene description.',
    retryable: true,
  },
];

const FALLBACK: UserFacingError = {
  code: 'unknown',
  message: 'Something went wrong generating this scene. Please try again.',
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
      return { code: rule.code, message: rule.message, retryable: rule.retryable };
    }
  }
  return FALLBACK;
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
