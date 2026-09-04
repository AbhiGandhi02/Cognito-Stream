/**
 * Pre-rendered "suggestion" demos shown on the dashboard's empty-state.
 *
 * Mirrors `server/src/lib/demo.ts` — the server keys the same six prompts to
 * the same six source storyboard ids. Clicking a suggestion still goes
 * through the real create → generate-code → render flow, which clones the
 * source into a storyboard the user owns (so it lands in their History and
 * reveals stage by stage). Only the *video bytes* are short-circuited here:
 * each source id maps to a copy checked into `client/public/demos/`, so
 * playback comes off the same CDN as the JS bundle instead of waiting on a
 * Supabase Storage fetch.
 *
 * Keep this list and `DEMO_PROMPTS` on the server in sync — a prompt present
 * there but missing here just falls back to the DB's `finalVideoUrl`.
 *
 * The bundled files are mirrored to `cognito-stream/demos/` in Supabase
 * Storage as a backup only; playback never touches it. The source
 * storyboards' own finals also still live under `cognito-stream/videos/`,
 * which is what the DB's `finalVideoUrl` points at (and what the fallback
 * above would fetch).
 */

import type { Storyboard } from '../types';

/** Static assets under `client/public/demos/`, served from the site root. */
const DEMOS_BASE_URL = '/demos';

export interface DemoSuggestion {
    prompt: string;
    /** Source storyboard id in the DB — the row the server clones from. */
    storyboardId: string;
    /** Slug of the bundled mp4 under `client/public/demos/`. */
    slug: string;
}

export const DEMO_SUGGESTIONS: DemoSuggestion[] = [
    {
        prompt: "Explain Newton's three laws of motion",
        storyboardId: 'cmp8uqube0002ypfom8ymvuob',
        slug: 'newtons-laws',
    },
    {
        prompt: 'What does a derivative actually measure?',
        storyboardId: 'cmp8vdg7l0002ijcuhql2ryhz',
        slug: 'derivative',
    },
    {
        prompt: 'How does an electromagnetic wave travel?',
        storyboardId: 'cmp8vwvh3000rijcu4tywv2v1',
        slug: 'electromagnetic-wave',
    },
    {
        prompt: 'Visualize integration as area under a curve',
        storyboardId: 'cmp8y9ll20002ak5ldklfn1rj',
        slug: 'integration-area',
    },
    {
        prompt: 'What is the Doppler effect?',
        storyboardId: 'cmpa3b7350002104f96a6nb9c',
        slug: 'doppler-effect',
    },
    {
        prompt: 'Explain matrix multiplication geometrically',
        storyboardId: 'cmpa56rzn000d104f5k06jd31',
        slug: 'matrix-multiplication',
    },
];

const SLUG_BY_SOURCE_ID = new Map(
    DEMO_SUGGESTIONS.map((d) => [d.storyboardId, d.slug])
);

/**
 * Absolute site-origin URL for a demo's bundled video, or null when the id
 * isn't a known demo source.
 *
 * Absolute on purpose: both `VideoPlayer` and the axios client treat a
 * non-`http` URL as API-server-relative and prefix `VITE_API_URL`, which
 * would send a `/demos/...` path to the wrong host. Anchoring it to
 * `window.location.origin` makes it a plain static fetch from the client's
 * own origin.
 */
export function localDemoVideoUrl(demoSourceId?: string | null): string | null {
    if (!demoSourceId) return null;
    const slug = SLUG_BY_SOURCE_ID.get(demoSourceId);
    if (!slug) return null;
    return `${window.location.origin}${DEMOS_BASE_URL}/${slug}.mp4`;
}

/**
 * The URL to actually play for a storyboard's final video.
 *
 * Matches on `demoSourceId` (a clone made from a suggestion) and on `id` (the
 * source storyboard itself, which is what the dashboard's public-endpoint
 * fallback loads — that response carries `id` but no `demoSourceId`).
 *
 * Returns null until the DB says the render finished — `finalVideoUrl` stays
 * the readiness signal, the local copy only substitutes the bytes.
 */
export function resolveFinalVideoUrl(
    storyboard: Pick<Storyboard, 'id' | 'finalVideoUrl' | 'demoSourceId'> | null | undefined
): string | null {
    if (!storyboard?.finalVideoUrl) return null;
    return (
        localDemoVideoUrl(storyboard.demoSourceId) ??
        localDemoVideoUrl(storyboard.id) ??
        storyboard.finalVideoUrl
    );
}
