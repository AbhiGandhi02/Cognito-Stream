/**
 * Explicit context caching for the Manim system prompt.
 *
 * The code-generation system prompt is ~6,400 tokens and byte-identical on
 * every scene call. A twelve-scene video therefore ships it twelve times and
 * pays full input rate each time — about Rs 5.10 of a ~Rs 15 video, for text
 * that never changes.
 *
 * Gemini's cached-input rate is 10x cheaper, so caching it once and referencing
 * it turns that into ~Rs 0.51. The cache is not per-video: the prompt is the
 * same for every user and every topic, so a single cache serves all traffic
 * until its TTL lapses.
 *
 * Deliberately best-effort. Caching is a cost optimisation, never a
 * correctness requirement — every failure path returns null and the caller
 * falls back to sending the prompt inline, producing byte-identical output for
 * more money. That matters because explicit caching has model-specific minimum
 * token thresholds that are not discoverable from the SDK, so a model change
 * could start rejecting cache creation with no warning.
 *
 * Note there is also IMPLICIT caching, which Gemini applies automatically and
 * free to repeated prefixes on 2.5+ models. If that is already engaging, this
 * module adds little — watch the `cached` figure in the per-video cost summary
 * to tell which is happening.
 */

import { createHash } from 'node:crypto';
import type { CachedContent } from '@google/generative-ai';

// Caching is on unless explicitly disabled. Set GEMINI_CACHE=off to force the
// inline path, e.g. to A/B the cost figures or to work around an outage.
const CACHE_ENABLED = (process.env.GEMINI_CACHE || 'on').toLowerCase() !== 'off';

// 30 minutes comfortably covers one video's code-generation loop plus its
// render-phase repairs. Storage bills per hour, so a short TTL means an idle
// server stops paying rather than holding a cache nobody is using.
const TTL_SECONDS = Number(process.env.GEMINI_CACHE_TTL_SECONDS) || 1800;

// Below this, caching is not worth a round-trip and may fall under the model's
// minimum cacheable size. ~2k tokens at the ~3.33 chars/token measured on this
// project's own prompts.
const MIN_CACHEABLE_CHARS = 6800;

// Re-created a minute before expiry so a call can never race the lapse.
const EXPIRY_MARGIN_MS = 60_000;

// After a failure, stop trying for a while. A model whose minimum-token
// threshold we do not meet would otherwise cost an extra failed round-trip on
// every single scene, making the optimisation both slower AND more expensive.
const FAILURE_BACKOFF_MS = 10 * 60_000;

interface Entry {
    content: CachedContent;
    expiresAt: number;
}

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CachedContent | null>>();
const blockedUntil = new Map<string, number>();

function keyFor(apiKey: string, model: string, systemPrompt: string): string {
    const h = createHash('sha256');
    // The api key is hashed in too: caches are per-project, so a key change
    // must not reuse a handle the new project cannot see.
    h.update(apiKey).update(' ').update(model).update(' ').update(systemPrompt);
    return h.digest('hex').slice(0, 32);
}

/**
 * Return a cached-content handle for this system prompt, creating one if
 * needed. Returns null whenever caching is unavailable — the caller must treat
 * null as "send it inline", never as an error.
 */
export async function getCachedSystemPrompt(
    apiKey: string,
    model: string,
    systemPrompt: string
): Promise<CachedContent | null> {
    if (!CACHE_ENABLED) return null;
    if (!systemPrompt || systemPrompt.length < MIN_CACHEABLE_CHARS) return null;

    const key = keyFor(apiKey, model, systemPrompt);

    if (Date.now() < (blockedUntil.get(key) ?? 0)) return null;

    const existing = entries.get(key);
    if (existing && Date.now() < existing.expiresAt - EXPIRY_MARGIN_MS) {
        return existing.content;
    }

    // Scenes render concurrently, so several workers can miss at once. Share
    // one creation rather than uploading the same prompt N times.
    const pending = inFlight.get(key);
    if (pending) return pending;

    const task = (async (): Promise<CachedContent | null> => {
        try {
            const { GoogleAICacheManager } = await import('@google/generative-ai/server');
            const manager = new GoogleAICacheManager(apiKey);
            const content = await manager.create({
                model: model.startsWith('models/') ? model : `models/${model}`,
                systemInstruction: systemPrompt,
                // The cached payload is the system instruction; the per-scene
                // prompt stays in the request, since that is what varies.
                contents: [],
                ttlSeconds: TTL_SECONDS,
                displayName: `manim-system-${key.slice(0, 8)}`,
            });
            entries.set(key, { content, expiresAt: Date.now() + TTL_SECONDS * 1000 });
            console.log(
                `[Gemini cache] created for ${model} (ttl ${TTL_SECONDS}s) — ` +
                `system prompt now billed at the cached rate.`
            );
            return content;
        } catch (err) {
            blockedUntil.set(key, Date.now() + FAILURE_BACKOFF_MS);
            console.warn(
                `[Gemini cache] unavailable for ${model} ` +
                `(${String((err as Error)?.message ?? err).slice(0, 180)}). ` +
                `Sending the system prompt inline; output is unaffected, cost is higher. ` +
                `Retrying in ${Math.round(FAILURE_BACKOFF_MS / 60000)} min.`
            );
            return null;
        } finally {
            inFlight.delete(key);
        }
    })();

    inFlight.set(key, task);
    return task;
}

/** Drop a handle the API has rejected, so the next call rebuilds it. */
export function invalidateCachedSystemPrompt(
    apiKey: string,
    model: string,
    systemPrompt: string
): void {
    entries.delete(keyFor(apiKey, model, systemPrompt));
}

/** Live cache state, for the /api/health/llm diagnostic. */
export function cacheStatus(): Array<{ name?: string; expiresInSec: number }> {
    return [...entries.values()].map((e) => ({
        name: e.content.name,
        expiresInSec: Math.max(0, Math.round((e.expiresAt - Date.now()) / 1000)),
    }));
}
