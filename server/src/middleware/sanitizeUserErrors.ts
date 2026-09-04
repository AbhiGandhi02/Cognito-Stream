// ==========================================
// USER ERROR SANITIZER MIDDLEWARE
// server/src/middleware/sanitizeUserErrors.ts
// ==========================================
//
// Scene.errorMessage / Storyboard.errorMessage hold the raw provider error so
// admins and logs keep full detail. Those rows are also returned straight to
// the owner's dashboard, which is how a raw Gemini 429 ("check your plan and
// billing details") ended up in front of end users.
//
// Rather than patching a dozen res.json call sites, this wraps res.json once
// per router and rewrites errorMessage on the way out. Mount it on the
// user-facing routers only — /api/admin deliberately keeps the raw text.

import { Request, Response, NextFunction } from 'express';
import { toUserMessage, classifyUserError } from '../services/userFacingError';

// Deep enough for { ...storyboard, scenes: [ { ...scene } ] } and arrays of
// storyboards. Bounded so a cyclic or unexpectedly deep payload can't spin.
const MAX_DEPTH = 6;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const next = scrub(item, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    // Preserve identity when nothing was rewritten, so a clean payload isn't
    // reallocated on every response.
    return changed ? mapped : value;
  }

  const source = value as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;

  for (const [key, val] of Object.entries(source)) {
    let next: unknown = val;

    if (key === 'errorMessage' && typeof val === 'string' && val !== '') {
      next = toUserMessage(val);
    } else if (val !== null && typeof val === 'object') {
      next = scrub(val, depth + 1);
    }

    if (next !== val) {
      // Copy lazily — most responses have no error at all and pass through
      // untouched.
      if (!out) out = { ...source };
      out[key] = next;
    }
  }

  return out ?? value;
}

export function sanitizeUserErrors(_req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    try {
      let safe = scrub(body);

      // A 5xx envelope carries a thrown error's raw text in `message`.
      // 4xx messages are our own validation/not-found copy — already safe and
      // more useful than a generic string, so leave them alone.
      if (
        res.statusCode >= 500 &&
        safe !== null &&
        typeof safe === 'object' &&
        !Array.isArray(safe)
      ) {
        const envelope = safe as Record<string, unknown>;
        if (typeof envelope.message === 'string') {
          safe = { ...envelope, message: classifyUserError(envelope.message).message };
        }
      }

      return originalJson(safe);
    } catch {
      // Sanitizing must never break a response.
      return originalJson(body);
    }
  }) as Response['json'];

  next();
}
