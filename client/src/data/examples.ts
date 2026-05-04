/**
 * Featured example videos shown on the landing page.
 *
 * Files live in Supabase Storage at `cognito-stream/examples/<slug>.mp4` and
 * are served via public URLs (the bucket is public, so no signed-URL handling).
 * Each entry has a fallback gradient thumbnail used when no poster image is
 * provided.
 */

const EXAMPLES_BASE_URL =
    'https://oianisuconpjdrlnhvsw.supabase.co/storage/v1/object/public/cognito-stream/examples';

export type ExampleCategory = 'Mathematics' | 'Physics' | 'Algorithms';

export interface ExampleVideo {
    id: string;
    title: string;
    category: ExampleCategory;
    description: string;
    videoUrl: string;
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
        duration: '0:30',
        gradient: 'from-blue-500/40 via-cyan-500/30 to-blue-700/40',
        glyph: 'a²+b²',
    },
    {
        id: 'bubble-sort',
        title: 'Bubble Sort',
        category: 'Algorithms',
        description: 'Watch numbers swap into order, one comparison at a time.',
        videoUrl: `${EXAMPLES_BASE_URL}/bubble-sort.mp4`,
        duration: '0:34',
        gradient: 'from-emerald-500/40 via-teal-500/30 to-emerald-700/40',
        glyph: '↔',
    },
    {
        id: 'pendulum-motion',
        title: 'Simple Pendulum',
        category: 'Physics',
        description: 'Simple harmonic motion derived from gravity and string length.',
        videoUrl: `${EXAMPLES_BASE_URL}/pendulum-motion.mp4`,
        duration: '0:31',
        gradient: 'from-purple-500/40 via-fuchsia-500/30 to-purple-700/40',
        glyph: '∿',
    },
    {
        id: 'binary-search',
        title: 'Binary Search',
        category: 'Algorithms',
        description: 'O(log n) lookup by halving a sorted range each step.',
        videoUrl: `${EXAMPLES_BASE_URL}/binary-search.mp4`,
        duration: '0:32',
        gradient: 'from-amber-500/40 via-orange-500/30 to-amber-700/40',
        glyph: '🔍',
    },
    {
        id: 'fourier-series',
        title: 'Fourier Series',
        category: 'Mathematics',
        description: 'A square wave reconstructed from sine waves, term by term.',
        videoUrl: `${EXAMPLES_BASE_URL}/fourier-series.mp4`,
        duration: '0:32',
        gradient: 'from-pink-500/40 via-rose-500/30 to-pink-700/40',
        glyph: '∑',
    },
    {
        id: 'wave-interference',
        title: 'Wave Interference',
        category: 'Physics',
        description: 'Two ripples meet — constructive and destructive overlap.',
        videoUrl: `${EXAMPLES_BASE_URL}/wave-interference.mp4`,
        duration: '0:32',
        gradient: 'from-sky-500/40 via-indigo-500/30 to-sky-700/40',
        glyph: '≋',
    },
];
