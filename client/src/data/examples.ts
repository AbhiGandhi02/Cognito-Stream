/**
 * Featured example videos shown on the landing page.
 *
 * Two-source data model:
 *   • Entries with `storyboardId` are fetched live from the public read
 *     endpoint (`/api/public/storyboard/:id`) — these are real generated
 *     videos stored against a storyboard row in the DB.
 *   • Entries with `videoUrl` use a static Supabase Storage URL — used for
 *     legacy examples that haven't been re-generated yet.
 *
 * Each entry has a fallback gradient + glyph used as the thumbnail before
 * the video's first frame paints.
 */

const EXAMPLES_BASE_URL =
    'https://oianisuconpjdrlnhvsw.supabase.co/storage/v1/object/public/cognito-stream/examples';

export type ExampleCategory = 'Mathematics' | 'Physics' | 'Algorithms';

export interface ExampleVideo {
    id: string;
    title: string;
    category: ExampleCategory;
    description: string;
    /** Live-fetched: storyboard id in the DB. The landing page resolves this
     *  to a `finalVideoUrl` at runtime via the public endpoint. */
    storyboardId?: string;
    /** Static fallback for legacy / not-yet-regenerated examples. */
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
        storyboardId: 'cmp7ddjk20002gg9l6fxnerm4',
        duration: '2:05',
        gradient: 'from-blue-500/40 via-cyan-500/30 to-blue-700/40',
        glyph: 'a²+b²=c²',
    },
    {
        id: 'bubble-sort',
        title: 'Bubble Sort',
        category: 'Algorithms',
        description: 'Watch numbers swap into order, one comparison at a time.',
        storyboardId: 'cmp7e7jde0002ut7idagxm429',
        duration: '2:13',
        gradient: 'from-emerald-500/40 via-teal-500/30 to-emerald-700/40',
        glyph: '↔',
    },
    {
        id: 'pendulum-motion',
        title: 'Simple Pendulum',
        category: 'Physics',
        description: 'Simple harmonic motion derived from gravity and string length.',
        storyboardId: 'cmp7eh8jr000lut7iqspklsw4',
        duration: '1:11',
        gradient: 'from-purple-500/40 via-fuchsia-500/30 to-purple-700/40',
        glyph: '∿',
    },
    {
        id: 'binary-search',
        title: 'Binary Search',
        category: 'Algorithms',
        description: 'O(log n) lookup by halving a sorted range each step.',
        storyboardId: 'cmp7erd7m000yut7ie31vgqiq',
        duration: '2:13',
        gradient: 'from-amber-500/40 via-orange-500/30 to-amber-700/40',
        glyph: '🔍',
    },
    {
        id: 'fourier-series',
        title: 'Fourier Series',
        category: 'Mathematics',
        description: 'A square wave reconstructed from sine waves, term by term.',
        storyboardId: 'cmp8rnbn9000a4j84qvrorr3k',
        duration: '1:28',
        gradient: 'from-pink-500/40 via-rose-500/30 to-pink-700/40',
        glyph: '∑',
    },
    {
        id: 'wave-interference',
        title: 'Wave Interference',
        category: 'Physics',
        description: 'Two ripples meet — constructive and destructive overlap.',
        storyboardId: 'cmp8skw2c0002135qegc0rta9',
        duration: '2:28',
        gradient: 'from-sky-500/40 via-indigo-500/30 to-sky-700/40',
        glyph: '≋',
    },
];
