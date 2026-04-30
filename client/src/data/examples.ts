/**
 * Featured example videos shown on the landing page.
 *
 * Files are served as static assets from `client/public/examples/`. Drop the
 * matching `.mp4` files there and they'll play instantly without invoking the
 * render pipeline. Each entry has a fallback gradient thumbnail used when no
 * poster image is provided.
 */

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
        videoUrl: '/examples/pythagorean-theorem.mp4',
        duration: '0:30',
        gradient: 'from-blue-500/40 via-cyan-500/30 to-blue-700/40',
        glyph: 'a²+b²',
    },
    {
        id: 'bubble-sort',
        title: 'Bubble Sort',
        category: 'Algorithms',
        description: 'Watch numbers swap into order, one comparison at a time.',
        videoUrl: '/examples/bubble-sort.mp4',
        duration: '0:34',
        gradient: 'from-emerald-500/40 via-teal-500/30 to-emerald-700/40',
        glyph: '↔',
    },
    {
        id: 'pendulum-motion',
        title: 'Simple Pendulum',
        category: 'Physics',
        description: 'Simple harmonic motion derived from gravity and string length.',
        videoUrl: '/examples/pendulum-motion.mp4',
        duration: '0:31',
        gradient: 'from-purple-500/40 via-fuchsia-500/30 to-purple-700/40',
        glyph: '∿',
    },
    {
        id: 'binary-search',
        title: 'Binary Search',
        category: 'Algorithms',
        description: 'O(log n) lookup by halving a sorted range each step.',
        videoUrl: '/examples/binary-search.mp4',
        duration: '0:32',
        gradient: 'from-amber-500/40 via-orange-500/30 to-amber-700/40',
        glyph: '🔍',
    },
    {
        id: 'fourier-series',
        title: 'Fourier Series',
        category: 'Mathematics',
        description: 'A square wave reconstructed from sine waves, term by term.',
        videoUrl: '/examples/fourier-series.mp4',
        duration: '0:32',
        gradient: 'from-pink-500/40 via-rose-500/30 to-pink-700/40',
        glyph: '∑',
    },
    {
        id: 'wave-interference',
        title: 'Wave Interference',
        category: 'Physics',
        description: 'Two ripples meet — constructive and destructive overlap.',
        videoUrl: '/examples/wave-interference.mp4',
        duration: '0:32',
        gradient: 'from-sky-500/40 via-indigo-500/30 to-sky-700/40',
        glyph: '≋',
    },
];
