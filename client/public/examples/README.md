# Example Videos

The 6 pre-recorded MP4s shown on the landing page **no longer live in this
directory** — they're stored in Supabase Storage at
`cognito-stream/examples/<slug>.mp4` and served via public URLs:

```
https://oianisuconpjdrlnhvsw.supabase.co/storage/v1/object/public/cognito-stream/examples/<slug>.mp4
```

The slug list and metadata (titles, descriptions, gradients) live in
[`client/src/data/examples.ts`](../../src/data/examples.ts). The base URL is
defined as a constant at the top of that file.

## Required filenames in the bucket

| Object key                                    | Topic                              |
|-----------------------------------------------|------------------------------------|
| `examples/pythagorean-theorem.mp4`            | a² + b² = c² (Mathematics)         |
| `examples/bubble-sort.mp4`                    | Bubble Sort visualization          |
| `examples/pendulum-motion.mp4`                | Simple Pendulum / SHM (Physics)    |
| `examples/binary-search.mp4`                  | Binary Search                      |
| `examples/fourier-series.mp4`                 | Fourier series of a square wave    |
| `examples/wave-interference.mp4`              | Two-source wave interference       |

## How to (re)generate the example videos

The cleanest path is to use the app itself in dev:

1. Start the renderer + server + client (`docker compose up renderer`,
   `npm run dev` in both).
2. From the dashboard, prompt for one of the six topics (e.g.,
   "Explain bubble sort with a 5-element array").
3. Click **Generate Code** → **Render Final Video**.
4. When the storyboard reaches `completed`, find the `_final.mp4` in
   `storage/output/` (named like `<storyboardId>_final.mp4`).
5. Rename it to the matching slug above and upload via Supabase dashboard
   (Storage → cognito-stream → examples/) **or** via curl:

   ```bash
   curl -X POST "https://oianisuconpjdrlnhvsw.supabase.co/storage/v1/object/cognito-stream/examples/<slug>.mp4" \
     -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
     -H "Content-Type: video/mp4" \
     -H "x-upsert: true" \
     --data-binary @<your-local-file>.mp4
   ```

6. Repeat for the remaining topics.

## Why the bucket and not `client/public/`?

Vercel's free tier handles 5 MB of static videos fine, but moving them out of
the repo:

- Keeps the React client bundle small and fast to deploy.
- Lets you swap example videos without a redeploy (just upload a new mp4 with
  the same key — the bucket allows upsert).
- Keeps git history clean of binary blobs.
