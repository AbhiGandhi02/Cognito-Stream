# Example Videos

These pre-recorded `.mp4` files back the **Example Animations** section on the landing page. They're served as static assets by Vite and play instantly with no backend / render pipeline involvement.

## Required filenames

The frontend expects exactly these six filenames in this directory:

| Filename | Topic | Category |
|---|---|---|
| `pythagorean-theorem.mp4` | a² + b² = c² | Mathematics |
| `bubble-sort.mp4` | Bubble Sort visualization | Algorithms |
| `pendulum-motion.mp4` | Simple Pendulum / SHM | Physics |
| `binary-search.mp4` | Binary Search on a sorted array | Algorithms |
| `fourier-series.mp4` | Fourier series of a square wave | Mathematics |
| `wave-interference.mp4` | Two-source wave interference | Physics |

If you want to change the list (titles, descriptions, gradient colors, filenames), edit
[`client/src/data/examples.ts`](../../src/data/examples.ts).

## How to generate them

The cleanest path is to use the app itself in dev:

1. Start the renderer + server + client (`docker compose up renderer`, `npm run dev` in both).
2. From the dashboard, prompt for one of the six topics (e.g., "Explain bubble sort with a 5-element array").
3. Click **Generate Code** → **Render Final Video**.
4. When the storyboard reaches `completed`, find the `_final.mp4` in `storage/output/` (named like `<storyboardId>_final.mp4`).
5. Rename it to the matching filename above and copy it into this directory.
6. Repeat for the remaining topics.

You can also drop in any other MP4s you have — they just need to use the exact filenames listed.

## Optional poster images

Each card uses a tailwind gradient + glyph as a thumbnail by default. If you want a real poster image (extracted first frame, custom artwork, etc.), drop a file like `pythagorean-theorem.jpg` next to the MP4 and add `posterUrl: '/examples/pythagorean-theorem.jpg'` to the matching entry in `examples.ts`.

## Why static files

These videos are decorative on the landing page — they should play in <1 second on click. Routing them through the backend (`/videos/:id`, the renderer proxy) would add latency and pointless server load. Vite serves anything in `client/public/` as-is at the same path, so `/examples/bubble-sort.mp4` just works.
