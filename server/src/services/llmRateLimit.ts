/**
 * Client-side request pacing for the Gemini API.
 *
 * Google enforces `ApiRequestsPerMinutePerProjectPerRegion` — a plain count of
 * API calls, which includes cheap ones like countTokens, not just generation.
 * Exceeding it returns 429, and our failover treats 429 as a quota signal and
 * puts the key into cooldown. So a burst does not merely slow down: it can
 * knock a working key out of rotation for the retry window.
 *
 * Pacing here is cheaper than recovering there.
 *
 * IMPORTANT: the quota is per PROJECT, not per key. Limiters are keyed by tier
 * because the primary (free) and secondary (paid) keys live in different Google
 * Cloud projects and therefore have independent budgets. If two keys ever share
 * a project, they share the quota too and this accounting would over-permit —
 * set both RPM values to half the project limit in that case.
 *
 * The window is deliberately generous by default. Sequential code generation
 * runs about one call every ten seconds (~6/min) and must never wait; the point
 * is to smooth the bursts, which come from the render phase running
 * SCENE_CONCURRENCY repair calls at once.
 */

// Requests allowed per rolling 60s, per tier.
//
// 5, not a comfortable-looking number: that is the quota this project was
// actually observed to have. A real 429 reported
//   quota_limit_value: 5, ApiRequestsPerMinutePerProjectPerRegion (asia-southeast1)
// so an earlier default of 15 would not have prevented the thing this exists to
// prevent — and a 429 is worse than a wait, because the failover logic reads it
// as a quota signal and puts the key into cooldown.
//
// The two keys live in DIFFERENT Google Cloud projects, so their quotas are
// independent and may differ; raise each with GEMINI_RPM_PRIMARY /
// GEMINI_RPM_SECONDARY once you have confirmed the real limit in the console.
//
// Cost of being conservative: sequential code generation runs ~6 calls/min
// naturally, so at 5/min a twelve-scene video waits roughly 45s in total. That
// is cheaper than one 429-induced key cooldown.
const DEFAULT_RPM = Number(process.env.GEMINI_RPM_DEFAULT) || 5;

function rpmFor(tier: string): number {
    const specific = Number(process.env[`GEMINI_RPM_${tier.toUpperCase()}`]);
    if (Number.isFinite(specific) && specific > 0) return specific;
    const shared = Number(process.env.GEMINI_RPM);
    if (Number.isFinite(shared) && shared > 0) return shared;
    return DEFAULT_RPM;
}

const WINDOW_MS = 60_000;

/**
 * Sliding-window limiter. Records the timestamp of each admitted request and,
 * once the window is full, waits exactly until the oldest one ages out.
 *
 * A fixed interval between calls would be simpler but strictly worse: it would
 * pace an idle server that has spent no budget, delaying the first scene of
 * every video for no reason.
 */
class SlidingWindowLimiter {
    private timestamps: number[] = [];
    /** Serialises admission so concurrent workers cannot all pass at once. */
    private tail: Promise<void> = Promise.resolve();

    constructor(private readonly tier: string) {}

    async acquire(): Promise<void> {
        const mine = this.tail.then(() => this.admit());
        // Swallow rejection on the chain itself so one failure cannot poison
        // every later caller; the awaited promise still surfaces normally.
        this.tail = mine.catch(() => undefined);
        return mine;
    }

    private async admit(): Promise<void> {
        const limit = rpmFor(this.tier);
        for (;;) {
            const now = Date.now();
            this.timestamps = this.timestamps.filter((t) => now - t < WINDOW_MS);
            if (this.timestamps.length < limit) {
                this.timestamps.push(now);
                return;
            }
            const waitMs = WINDOW_MS - (now - this.timestamps[0]) + 50;
            console.log(
                `[Gemini:${this.tier}] rate limit reached (${limit}/min) — ` +
                `pacing ${(waitMs / 1000).toFixed(1)}s before the next request.`
            );
            // unref'd: a pending pace timer must not keep the Node process
            // alive on shutdown, and must not hold Jest open after a run.
            await new Promise<void>((resolve) => {
                const t = setTimeout(resolve, waitMs);
                if (typeof t.unref === 'function') t.unref();
            });
        }
    }
}

const limiters = new Map<string, SlidingWindowLimiter>();

/** Wait until this tier is allowed to issue another request. */
export async function acquireLLMSlot(tier: string): Promise<void> {
    let limiter = limiters.get(tier);
    if (!limiter) {
        limiter = new SlidingWindowLimiter(tier);
        limiters.set(tier, limiter);
    }
    await limiter.acquire();
}

/** Configured limits, for diagnostics. */
export function rateLimitStatus(): Record<string, number> {
    return {
        primary: rpmFor('primary'),
        secondary: rpmFor('secondary'),
    };
}
