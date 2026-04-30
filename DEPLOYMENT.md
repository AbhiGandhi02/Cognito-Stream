# Cognito-Stream — Free-Tier Deployment Guide

Deploy the entire stack on **$0/month** using free tiers only.

| Piece              | Where it runs                | Free-tier limit                                    |
| ------------------ | ---------------------------- | -------------------------------------------------- |
| Frontend (React)   | **Vercel**                   | 100 GB bandwidth/mo, unlimited builds              |
| Server (Node API)  | **Render** (Web Service)     | 512 MB RAM, sleeps after 15 min idle, 750 hr/mo   |
| Renderer (Manim)   | **Hugging Face Docker Space**| 16 GB RAM, 2 vCPU, sleeps after 48 hr             |
| DB + Auth + Storage| **Supabase**                 | 500 MB DB, 1 GB storage, 5 GB egress, 50 k MAU    |

> Cold-start trade-off: the free Render server sleeps and the free HF Space
> sleeps. The first request after idle takes ~30–60 s to wake. Subsequent
> requests are fast.

---

## Step 0 — Prerequisites

- GitHub account (the repo must be pushed there for Vercel/Render/HF to deploy)
- Supabase account (project `oianisuconpjdrlnhvsw` is the one you're already using)
- Vercel account (free, sign in with GitHub)
- Render account (free, sign in with GitHub)
- Hugging Face account (free, sign in with email/Google)

**Rotate any leaked secrets first.** The `server/.env` in this repo currently
contains live keys. Before you push anything to GitHub:

1. Confirm `server/.env` and root `.env` are gitignored (they are — `.gitignore:7` matches `*.env`)
2. Rotate the Supabase database password, JWT secret, and service-role key in
   the Supabase dashboard
3. Get a fresh Gemini key from Google AI Studio and a fresh Groq key from
   console.groq.com — both free
4. Update your local `server/.env` and root `.env` with the new values

---

## Step 1 — Create the Supabase Storage bucket

1. Open https://supabase.com/dashboard/project/oianisuconpjdrlnhvsw
2. Left sidebar → **Storage**
3. Click **New bucket**
   - Name: `cognito-stream`
   - **Public bucket: ON** (so video URLs are directly playable in `<video>` tags)
   - File size limit: leave default (50 MB)
   - Click **Save**

The renderer uploads via the service-role key, which bypasses RLS, so no
policies are required for upload. Public reads are allowed because the bucket
is public.

---

## Step 2 — Configure Supabase Auth (Google OAuth)

1. Supabase dashboard → **Authentication** → **Providers** → **Google**
2. Toggle **Enable**
3. In Google Cloud Console (https://console.cloud.google.com/apis/credentials):
   - Create OAuth client (type: Web application)
   - Authorized redirect URIs:
     `https://oianisuconpjdrlnhvsw.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client secret** back into Supabase
4. Save

Later (after Vercel deploy in Step 5) you'll come back here and add the Vercel
URL to **Authentication → URL Configuration → Site URL** and **Redirect URLs**.

---

## Step 3 — Deploy the renderer to Hugging Face Docker Space

1. Go to https://huggingface.co/new-space
2. Owner: your username
3. Space name: `cognito-stream-renderer`
4. License: MIT (or whatever you prefer)
5. **Space SDK: Docker** → **Blank** template
6. Hardware: **CPU basic — Free**
7. Visibility: **Public** (private Spaces require a Pro subscription)
8. Click **Create Space**

Push the renderer to the new Space:

```bash
# from the repo root
git clone https://huggingface.co/spaces/<your-username>/cognito-stream-renderer hf-space
cp -r renderer/* hf-space/
cd hf-space

# HF Spaces require a README.md with a frontmatter block at the top
cat > README.md <<'EOF'
---
title: Cognito Stream Renderer
emoji: 🎬
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 5000
---

Manim + Piper TTS rendering service for cognito-stream.
EOF

git add .
git commit -m "Initial renderer push"
git push
```

The first build takes ~10–15 minutes (LaTeX is slow). Watch logs in the HF
Space UI.

Once built, set the environment variables under
**Settings → Variables and secrets**:

| Key                          | Value                                                 |
| ---------------------------- | ----------------------------------------------------- |
| `PORT`                       | `5000`                                                |
| `OUTPUT_DIR`                 | `/app/output`                                         |
| `TEMP_DIR`                   | `/app/temp`                                           |
| `AUDIO_DIR`                  | `/app/audio`                                          |
| `DEFAULT_RENDER_QUALITY`     | `medium`                                              |
| `SUPABASE_URL`               | `https://oianisuconpjdrlnhvsw.supabase.co`            |
| `SUPABASE_SERVICE_ROLE_KEY`  | (paste the freshly-rotated service-role key — secret) |
| `SUPABASE_STORAGE_BUCKET`    | `cognito-stream`                                      |

Mark `SUPABASE_SERVICE_ROLE_KEY` as **secret** so HF redacts it in logs.

Click **Restart Space**. Your renderer URL will be
`https://<your-username>-cognito-stream-renderer.hf.space`. Test it:

```bash
curl https://<your-username>-cognito-stream-renderer.hf.space/health
# {"status":"ok",...}
```

---

## Step 4 — Deploy the Node server to Render

1. Go to https://dashboard.render.com → **New +** → **Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Name:** `cognito-stream-server`
   - **Region:** Oregon (or closest to you)
   - **Branch:** `master`
   - **Root directory:** `server`
   - **Runtime:** Node
   - **Build command:** `npm install && npx prisma generate && npm run build`
   - **Start command:** `node dist/index.js`
   - **Instance type:** **Free**
4. Add environment variables (Advanced → Add Environment Variable):

| Key                         | Value                                                     |
| --------------------------- | --------------------------------------------------------- |
| `NODE_ENV`                  | `production`                                              |
| `PORT`                      | `3000`                                                    |
| `DATABASE_URL`              | (your rotated Supabase pooler connection string)          |
| `SUPABASE_JWT_SECRET`       | (your rotated JWT secret)                                 |
| `RENDERER_URL`              | `https://<your-username>-cognito-stream-renderer.hf.space`|
| `CLIENT_URL`                | (Vercel URL — you'll fill this in Step 5)                 |
| `GEMINI_API_KEY`            | (rotated key)                                             |
| `GEMINI_MODEL`              | `gemini-2.5-flash`                                        |
| `GEMINI_CODE_MODEL`         | `gemini-2.5-flash`                                        |
| `GROQ_API_KEY`              | (rotated key)                                             |
| `GROQ_MODEL`                | `llama-3.3-70b-versatile`                                 |

5. Click **Create Web Service**. First build takes ~3–5 min.

Render assigns a URL like `https://cognito-stream-server.onrender.com`. Test it:

```bash
curl https://cognito-stream-server.onrender.com/health
```

---

## Step 5 — Deploy the React client to Vercel

1. https://vercel.com/new → import the GitHub repo
2. **Framework preset:** Vite
3. **Root directory:** `client`
4. **Build command:** `npm run build` (auto-detected)
5. **Output directory:** `dist` (auto-detected)
6. **Environment variables:**

| Key                       | Value                                                |
| ------------------------- | ---------------------------------------------------- |
| `VITE_SUPABASE_URL`       | `https://oianisuconpjdrlnhvsw.supabase.co`           |
| `VITE_SUPABASE_ANON_KEY`  | (Supabase dashboard → Settings → API → anon key)     |
| `VITE_API_URL`            | `https://cognito-stream-server.onrender.com`         |

7. Click **Deploy**. Vercel hands you a URL like
   `https://cognito-stream.vercel.app`.

Now go back and:

- **Render dashboard** → server → Environment → set `CLIENT_URL` to the Vercel URL → Save
- **Supabase dashboard** → Authentication → URL Configuration:
  - **Site URL:** `https://cognito-stream.vercel.app`
  - **Redirect URLs:** add `https://cognito-stream.vercel.app/dashboard` and
    `https://cognito-stream.vercel.app/auth`

---

## Step 6 — Promote your admin user

After signing in once with `abhigandhi0212@gmail.com` on the live site, run a
SQL query in the Supabase SQL Editor:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'abhigandhi0212@gmail.com';
```

Or run `server/check_db.mjs` locally with the production `DATABASE_URL`:

```bash
cd server
DATABASE_URL="<production-url>" node check_db.mjs
```

---

## Step 7 — Smoke test

1. Visit `https://cognito-stream.vercel.app`
2. Sign in with Google
3. Generate a short video (e.g., "Animate the area of a circle")
4. Watch the browser network tab — `/api/storyboard` and `/api/render` calls
   should hit the Render URL and return 2xx
5. Final video should play from a Supabase public URL
6. As admin, the **/admin** route should show the storyboard with prompt,
   status, and any error/correction-attempt diagnostics

---

## Cost summary

| Service           | Tier                | Monthly cost |
| ----------------- | ------------------- | ------------ |
| Vercel            | Hobby               | $0           |
| Render            | Free Web Service    | $0           |
| Hugging Face      | Free Docker Space   | $0           |
| Supabase          | Free plan           | $0           |
| Google Cloud (LLM)| Gemini free quota   | $0 (10 RPM)  |
| Groq              | Free API            | $0           |
| **Total**         |                     | **$0**       |
