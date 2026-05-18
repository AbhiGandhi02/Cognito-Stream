/**
 * Demo prompt registry.
 *
 * Pre-rendered "suggestion" storyboards from the dashboard's empty-state.
 * When a user submits one of these exact prompts (or the client passes
 * `demoStoryboardId` in the create body), the server clones the source
 * storyboard into a new row owned by the user — no LLM or renderer call.
 *
 * The map is keyed by the canonical prompt text. Source IDs point at the
 * one-shot pre-rendered storyboards seeded by the project owner.
 */

export const DEMO_PROMPTS: Record<string, string> = {
    "Explain Newton's three laws of motion": 'cmp8uqube0002ypfom8ymvuob',
    'What does a derivative actually measure?': 'cmp8vdg7l0002ijcuhql2ryhz',
    'How does an electromagnetic wave travel?': 'cmp8vwvh3000rijcu4tywv2v1',
    'Visualize integration as area under a curve': 'cmp8y9ll20002ak5ldklfn1rj',
    'What is the Doppler effect?': 'cmpa3b7350002104f96a6nb9c',
    'Explain matrix multiplication geometrically': 'cmpa56rzn000d104f5k06jd31',
};

/**
 * Resolve a demo source storyboard ID for an incoming prompt.
 *
 * Detection order:
 *   1. Explicit `demoStoryboardId` from the client (must be in the
 *      registered values — prevents an attacker from skipping LLM by
 *      passing an arbitrary id).
 *   2. Exact match on `DEMO_PROMPTS` keys (case- and whitespace-trimmed).
 *
 * Returns null if neither matches.
 */
export function findDemoSource(prompt: string, demoFlag?: string): string | null {
    const validSourceIds = new Set(Object.values(DEMO_PROMPTS));

    // 1. Explicit client flag — but only if it's in the registry.
    if (demoFlag && validSourceIds.has(demoFlag)) {
        return demoFlag;
    }

    // 2. Exact prompt match (trimmed).
    const trimmed = prompt.trim();
    if (DEMO_PROMPTS[trimmed]) {
        return DEMO_PROMPTS[trimmed];
    }

    return null;
}
