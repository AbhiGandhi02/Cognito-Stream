# Example Videos

The 6 pre-recorded MP4s shown on the landing page live **in this directory**,
served as static assets from the site root (`/examples/<slug>.mp4`).

They used to be fetched at runtime: each card called
`/api/public/storyboard/:id` on the API server, read `finalVideoUrl` off the
response, and only then started downloading the mp4 from Supabase Storage.
On the free tier that meant a cold-starting server plus a storage round-trip
before the gallery showed anything. Serving them from `public/` removes both
hops — the videos come off the same CDN as the JS bundle.

Each video has a tiny (~1 KB) first-frame `.jpg` next to it, used as the
`poster` so the card paints before the mp4's metadata arrives.

The slug list and metadata (titles, descriptions, durations, gradients) live
in [`client/src/data/examples.ts`](../../src/data/examples.ts), where
`EXAMPLES_BASE_URL` is the `/examples` path prefix.

## Files

| File                            | Topic                              |
|---------------------------------|------------------------------------|
| `pythagorean-theorem.mp4/.jpg`  | a² + b² = c² (Mathematics)         |
| `bubble-sort.mp4/.jpg`          | Bubble Sort visualization          |
| `pendulum-motion.mp4/.jpg`      | Simple Pendulum / SHM (Physics)    |
| `binary-search.mp4/.jpg`        | Binary Search                      |
| `fourier-series.mp4/.jpg`       | Fourier series of a square wave    |
| `wave-interference.mp4/.jpg`    | Two-source wave interference       |

Total ~15 MB. Keep it that way — anything much larger belongs in the bucket.

## Backup copy in the bucket (not used at runtime)

Every file here is also mirrored to Supabase Storage at
`cognito-stream/examples/<name>` as a backup. **Nothing reads it** — the app
only ever loads `/examples/...` from the client's own origin. It exists so the
videos survive a lost checkout, and so a bucket copy can be pulled back down.

Re-push the mirror after changing any file here:

```bash
curl -X POST "$SUPABASE_URL/storage/v1/object/cognito-stream/examples/<name>" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: video/mp4" -H "x-upsert: true" \
  --data-binary @client/public/examples/<name>
```

The dashboard's suggestion videos are mirrored the same way under
`cognito-stream/demos/` — see `client/src/data/demos.ts`.

## How to (re)generate an example video

1. Start the renderer + server + client (`docker compose up renderer`,
   `npm run dev` in both).
2. From the dashboard, prompt for the topic (e.g. "Explain bubble sort with a
   5-element array").
3. Click **Generate Code** → **Render Final Video**.
4. When the storyboard reaches `completed`, grab the `_final.mp4` from
   `storage/output/` (named `<storyboardId>_final.mp4`), or the uploaded copy
   under `videos/` in the bucket if Supabase creds were set.
5. Drop it here as `<slug>.mp4` and refresh the poster:

   ```bash
   ffmpeg -y -i <slug>.mp4 -vf "select=eq(n\,0),scale=480:-1" -frames:v 1 -q:v 6 <slug>.jpg
   ```

6. Commit both files. No redeploy dance beyond the normal client deploy.

## Adding an example without checking in a binary

`examples.ts` still supports the old model: give an entry a `storyboardId`
instead of a `videoUrl` and the landing page resolves it at runtime through
`/api/public/storyboard/:id`. Slower to first paint, but no repo weight —
useful for a one-off or while evaluating a new example.
