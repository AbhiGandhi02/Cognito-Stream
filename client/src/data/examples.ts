/**
 * Featured example videos shown on the landing page.
 *
 * The six featured videos are served as static assets from
 * `client/public/examples/` — no API call, no Supabase round-trip, so the
 * gallery paints as fast as the rest of the page. On the deployed client
 * they come off the CDN alongside the JS bundle; previously each card had
 * to wait on `/api/public/storyboard/:id` (cold-starting the free-tier
 * server) before it even knew which URL to fetch.
 *
 * Two-source data model (the loader still supports both):
 *   • Entries with `videoUrl` are used as-is — that's all six today,
 *     pointing at `/examples/<slug>.mp4`.
 *   • Entries with only a `storyboardId` are resolved at runtime through
 *     the public read endpoint (`/api/public/storyboard/:id`). Kept for
 *     adding a freshly generated example without checking a binary in.
 *
 * Each entry has a fallback gradient + glyph used as the thumbnail before
 * the poster/first frame paints.
 *
 * The same files are mirrored to `cognito-stream/examples/` in Supabase
 * Storage as a backup, but nothing here reads that copy — see the README in
 * `client/public/examples/`.
 */

/** Static assets under `client/public/examples/`, served from the site root. */
const EXAMPLES_BASE_URL = '/examples';

export type ExampleCategory = 'Mathematics' | 'Physics' | 'Algorithms';

export interface ExampleVideo {
    id: string;
    title: string;
    category: ExampleCategory;
    description: string;
    /** Live-fetched: storyboard id in the DB. Only consulted when `videoUrl`
     *  is absent — the landing page then resolves it to a `finalVideoUrl` at
     *  runtime via the public endpoint. */
    storyboardId?: string;
    /** Static asset path, e.g. `/examples/bubble-sort.mp4`. Preferred: it
     *  skips the API + storage round-trip entirely. */
    videoUrl?: string;
    /** Optional poster image (jpg/png) for the thumbnail. Falls back to gradient. */
    posterUrl?: string;
    /** Display-friendly duration like "0:42". */
    duration: string;
    /** Tailwind gradient classes used for the placeholder thumbnail. */
    gradient: string;
    /** Single-character glyph shown over the gradient as a visual anchor. */
    glyph: string;
}

export const EXAMPLE_VIDEOS: ExampleVideo[] = [
    {
        id: 'pythagorean-theorem',
        title: 'Pythagorean Theorem',
        category: 'Mathematics',
        description: 'How a² + b² = c² becomes intuitive when you see the squares.',
        videoUrl: `${EXAMPLES_BASE_URL}/pythagorean-theorem.mp4`,
        posterUrl: `${EXAMPLES_BASE_URL}/pythagorean-theorem.jpg`,
        duration: '2:05',
        gradient: 'from-blue-500/40 via-cyan-500/30 to-blue-700/40',
        glyph: 'a²+b²=c²',
    },
    {
        id: 'bubble-sort',
        title: 'Bubble Sort',
        category: 'Algorithms',
        description: 'Watch numbers swap into order, one comparison at a time.',
        videoUrl: `${EXAMPLES_BASE_URL}/bubble-sort.mp4`,
        posterUrl: `${EXAMPLES_BASE_URL}/bubble-sort.jpg`,
        duration: '2:13',
        gradient: 'from-emerald-500/40 via-teal-500/30 to-emerald-700/40',
        glyph: '↔',
    },
    {
        id: 'pendulum-motion',
        title: 'Simple Pendulum',
        category: 'Physics',
        description: 'Simple harmonic motion derived from gravity and string length.',
        videoUrl: `${EXAMPLES_BASE_URL}/pendulum-motion.mp4`,
        posterUrl: `${EXAMPLES_BASE_URL}/pendulum-motion.jpg`,
        duration: '1:11',
        gradient: 'from-purple-500/40 via-fuchsia-500/30 to-purple-700/40',
        glyph: '∿',
    },
    {
        id: 'binary-search',
        title: 'Binary Search',
        category: 'Algorithms',
        description: 'O(log n) lookup by halving a sorted range each step.',
        videoUrl: `${EXAMPLES_BASE_URL}/binary-search.mp4`,
        posterUrl: `${EXAMPLES_BASE_URL}/binary-search.jpg`,
        duration: '2:13',
        gradient: 'from-amber-500/40 via-orange-500/30 to-amber-700/40',
        glyph: '🔍',
    },
    {
        id: 'fourier-series',
        title: 'Fourier Series',
        category: 'Mathematics',
        description: 'A square wave reconstructed from sine waves, term by term.',
        videoUrl: `${EXAMPLES_BASE_URL}/fourier-series.mp4`,
        posterUrl: `${EXAMPLES_BASE_URL}/fourier-series.jpg`,
        duration: '1:28',
        gradient: 'from-pink-500/40 via-rose-500/30 to-pink-700/40',
        glyph: '∑',
    },
    {
        id: 'wave-interference',
        title: 'Wave Interference',
        category: 'Physics',
        description: 'Two ripples meet — constructive and destructive overlap.',
        videoUrl: `${EXAMPLES_BASE_URL}/wave-interference.mp4`,
        posterUrl: `${EXAMPLES_BASE_URL}/wave-interference.jpg`,
        duration: '2:28',
        gradient: 'from-sky-500/40 via-indigo-500/30 to-sky-700/40',
        glyph: '≋',
    },
];
