# Cognito Stream — Project Explainer (Interview Prep)

> **One-line pitch:** Cognito Stream turns a plain-English prompt (e.g. *"Explain the Pythagorean theorem"*) into a **fully narrated, animated educational video** — the kind 3Blue1Brown makes by hand — automatically, using LLMs to write the animation code and a Python renderer to produce the final MP4.

This document explains **what the project is, how each piece works, how they talk to each other, and the end-to-end workflow**, plus a list of likely interview questions with answers.

---

## 1. The 30-second elevator pitch

A user types a topic. The system:
1. Asks an **LLM to break the topic into scenes** (a "storyboard" — narration + visual description per scene).
2. Asks an **LLM to write [Manim](https://www.manim.community/) Python animation code** for each scene.
3. **Renders** each scene to video with Manim, **auto-correcting** the code with the LLM if it crashes.
4. Generates **voiceover narration** with a text-to-speech engine.
5. **Stitches** audio + video per scene and **concatenates** them into one final narrated MP4.

The hard problems solved here are: (a) getting an LLM to reliably emit *runnable* animation code, and (b) orchestrating a multi-stage, failure-prone pipeline at scale.

---

## 2. Architecture — three services (a monorepo)

```
┌─────────────┐     HTTPS/JWT      ┌──────────────────┐   HTTP (internal)  ┌────────────────────┐
│   CLIENT    │ ─────────────────▶ │   SERVER (API)   │ ─────────────────▶ │   RENDERER         │
│ React + Vite│ ◀───────────────── │ Express+Prisma+TS│ ◀───────────────── │ Python Flask+Manim │
└─────────────┘   storyboard JSON  └──────────────────┘   video/audio URLs └────────────────────┘
       │                                    │                                        │
       │ Supabase Auth (JWT)                │ Postgres (Prisma)                      │ FFmpeg + Piper TTS
       ▼                                    ▼                                        ▼
  Supabase (login)                   Supabase DB                            Supabase Storage (MP4/MP3)
```

| Folder | Stack | Responsibility |
|--------|-------|----------------|
| `client/` | React 19, TypeScript, Vite, Tailwind, react-router | The UI: landing page, auth, dashboard (prompt → storyboard → preview), history, admin panel. |
| `server/` | Node, Express, TypeScript, Prisma (Postgres), Zod | The brain. Talks to LLMs, persists storyboards/scenes, **orchestrates** the whole pipeline, gates everything behind auth. |
| `renderer/` | Python, Flask, Manim, FFmpeg, Piper TTS | The muscle. Runs the generated Manim code in a sandbox, renders MP4s, does TTS, stitches & concatenates the final video. |

**Why three services?** Separation of concerns + different runtimes. Manim/FFmpeg are heavy Python/C tools that need their own container with lots of RAM; the API is lightweight Node; the client is a static SPA. They scale and deploy independently.

---

## 3. The data model (Prisma / Postgres)

Four tables (`server/prisma/schema.prisma`):

- **`User`** — mirrors a Supabase Auth user. `id` is the Supabase `auth.users` UUID (we don't generate it). Has a `role` (`USER` / `ADMIN`). A row is **upserted on the first authenticated request** so we can foreign-key to it.
- **`Storyboard`** — one per prompt. Holds `prompt`, `title`, `description`, `status` (`draft → processing → completed/failed`), `finalVideoUrl`, `totalDuration`, and a relation to its scenes. Owned by a `userId`.
- **`Scene`** — one per scene. Holds `narration`, `visualDescription`, **`manimCode`** (the generated Python), `status`, `videoUrl`, `audioUrl`, `thumbnailUrl`, `actualDuration`, `errorMessage`, and **`correctionAttempts`** (how many times the LLM had to fix its own code).
- **`RenderJob`** — an optional job-queue table (scaffolding for async processing).

> **Interview note:** Scenes have a unique constraint `(storyboardId, sceneNumber)` and a cascade delete from their storyboard. The schema captures errors at *both* levels — storyboard-level (e.g. the LLM outage during planning) and per-scene (e.g. a render crash) — which is what powers the admin diagnostics.

---

## 4. End-to-end workflow (the most important part)

### Step 0 — Auth
The client signs the user in via **Supabase Auth**. Supabase issues a **JWT**. The client's Axios instance (`client/src/services/api.ts`) injects `Authorization: Bearer <jwt>` on every request. The server's `requireAuth` middleware (`server/src/middleware/auth.ts`) verifies the JWT with the shared `SUPABASE_JWT_SECRET` (HS256, via the `jose` library), then upserts the `User` row and attaches `req.user`. All `/api/*` routes are gated; admin routes additionally require `role === 'ADMIN'`.

### Step 1 — Prompt → Storyboard (scene planning)
`POST /api/storyboard` with `{ prompt }`.
- The server calls `generateStoryboard()` (`server/src/services/gemini.ts`), which asks the LLM to return a **JSON array of scenes**, each with `scene_title`, `narration`, and `visual_description`.
- The response is parsed (handles raw JSON *or* markdown-fenced JSON), validated, and **persisted**: one `Storyboard` row + N `Scene` rows (status `pending`), inside a Prisma transaction.
- If `autoGenerate !== false`, the server immediately kicks off the full pipeline **in the background** (fire-and-forget) and returns the storyboard right away. The client then **polls** `GET /api/storyboard/:id` until status flips to `completed`/`failed`.

### Step 2 — Scene → Manim code (per scene)
The orchestrator (`server/src/services/orchestrator.ts`) processes scenes. For each scene, `generateManimSceneCode()` asks the LLM to write a **complete Manim Python class** named `GeneratedScene`, guided by a large **system prompt** (`server/src/services/prompts.ts`) full of rules about what Manim APIs exist.

### Step 3 — Render with a self-correction loop
This is the cleverest part. The server sends the code to the renderer's `POST /render-code` endpoint:
1. Renderer does a **fast Python `ast.parse()`** (catches syntax errors in microseconds — saves a 60–90s render).
2. Renderer **lints with flake8** (catches undefined names / bad imports).
3. Renderer runs **Manim** via subprocess to produce the MP4.
4. If any step fails, the renderer returns **structured error info** (error type + parsed message + stderr tail).
5. The server feeds that error back to the LLM via `correctManimCode()`, gets fixed code, and **retries** — up to `MAX_CORRECTION_ATTEMPTS = 3`.

Every correction attempt is counted and stored on the scene (`correctionAttempts`).

### Step 4 — Narration (TTS)
Once the scene renders, the server calls the renderer's `POST /tts` endpoint. The renderer uses **Piper** (a local, offline neural TTS) to synthesize narration → WAV → MP3.

> **Note on naming:** the service file is `elevenlabs.ts` and the env example mentions ElevenLabs, but the **actual TTS in production is Piper**, run inside the renderer (`console.log('TTS provider: Piper')` in `server/src/index.ts`). This is a good thing to mention as an honest "we migrated TTS providers" detail.

### Step 5 — Assemble the final video
After all scenes finish, the server calls `POST /assemble`. The renderer:
1. **Stitches** each scene's audio onto its video (pads the video's last frame so narration always plays in full — `tpad` filter).
2. **Concatenates** all per-scene videos into one MP4 (FFmpeg concat demuxer).
3. Concatenates all per-scene narration into one MP3 voice track.
4. **Uploads** the final MP4/MP3 to **Supabase Storage** and returns public URLs.
5. Deletes the per-scene intermediates to keep storage lean.

The server saves `finalVideoUrl` + `totalDuration` on the storyboard and marks it `completed`. The client's poller sees this and shows the finished video.

### Concurrency
Scenes are processed by a **rolling worker pool** (default `SCENE_CONCURRENCY = 6`), not one-at-a-time. As soon as one scene finishes, the next pending one starts — so a 6-scene storyboard renders roughly as fast as a single scene. Completed scenes also feed a running summary back into later scenes' prompts so the LLM keeps **narrative continuity** (same notation, variables, examples across scenes).

---

## 5. The LLM layer — the part interviewers will probe

Located in `server/src/services/gemini.ts` (the name is historical — it's now multi-provider).

### Multi-provider fallback cascade
Calls go through `callLLMText()`, which tries providers in order:

**OpenRouter (DeepSeek V3.1) → Gemini → Groq (Llama 3.3 70B)**

- Each tier is **skipped if unconfigured or in cooldown**.
- When a provider returns a quota/auth/5xx error, it's put in a **30-minute cooldown** (2 min for Groq, since its limits reset per minute) and traffic routes to the next tier.
- Errors are categorized (`quota` / `auth` / `server` / `other`) so we only fail over on the right ones.
- `GET /api/health/llm` probes all three live and reports which work + cooldown state.

**Why?** Free-tier LLM APIs are flaky and rate-limited. The cascade gives **resilience** — if Gemini is rate-limited mid-generation, the system silently keeps working on Groq.

### Provider rotation on retries
For code generation, each retry attempt **forces a different provider**. Rationale: a model that keeps emitting the same broken pattern gets bypassed automatically. Correction attempts deliberately start at the *next* provider (don't ask the model that just failed to fix itself).

### Defensive code handling (making LLM output runnable)
Because LLMs hallucinate non-existent Manim APIs, the server does **three layers of defense** *before* paying for a render:
1. **`normalizeManimCode()`** — auto-fix transforms that rewrite known-bad patterns: rename any `Scene` subclass to `GeneratedScene`, replace invented methods (`.to_center()` → `.move_to(ORIGIN)`), strip HTML tags from `Text()`, strip invalid dash kwargs, fix `SuccessionGroup` → `Succession`, etc. (Idempotent — safe to re-run on cached code.)
2. **`validateManimCode()`** — static checks that throw *into the retry loop* if the code is structurally wrong or uses known-hallucinated APIs (`.get_lines()`, `CENTER`, `get_tangent_line`, bad import paths, unbalanced parens = truncation, etc.). Catching these here saves a wasted 60–90s render round-trip.
3. **Renderer-side AST parse + flake8** — final gate before Manim runs.

> **This is the single most impressive engineering story in the project**: turning an unreliable text generator into a reliable code-producing component through layered validation + a feedback-correction loop.

---

## 6. The renderer in detail (`renderer/app.py`)

A Flask app exposing:

| Endpoint | Purpose |
|----------|---------|
| `POST /render-code` | Render full Manim Python code → MP4 (AST parse → flake8 → Manim subprocess → find/move output → thumbnail). Returns structured errors for the correction loop. |
| `POST /tts` | Piper TTS: text → WAV → MP3. |
| `POST /assemble` | Stitch audio+video per scene, concat into final MP4, upload to Supabase. |
| `POST /render` | Legacy "operation-string" render mode (older approach). |
| `GET /health`, `/stats` | Health + render statistics (success rate, avg render time). |

**Security sandbox:** Manim runs as a subprocess. There's a `SAFE_GLOBALS` whitelist and a `validate_manim_code()` blacklist (blocks `import`, `exec`, `eval`, `subprocess`, `os.`, `__`, `lambda`, etc.) for the legacy operation mode. **Quality presets** (`low`/`medium`/`high`/`ultra`) trade render speed vs resolution; default is `low` (854×480) for ~3× faster renders.

**Storage:** If Supabase Storage env vars are set, finals are uploaded to a bucket and public URLs returned; otherwise files stay on local disk and relative `/videos/...` paths are served. This makes local dev and cloud deploy use the same code path.

---

## 7. The client (`client/src/`)

- **Routing** (`App.tsx`): `/` landing page, `/login` & `/signup` (Supabase auth), `/dashboard` (the workspace, `ProtectedRoute`-gated), `/dashboard/:storyboardId`, `/history`, `/admin`.
- **`AuthContext`** wraps the app and exposes the Supabase session.
- **`api.ts`** is a singleton Axios client that auto-injects the JWT and **auto-signs-out on 401**. It also contains the **polling helpers** (`waitForStoryboardCompletion`) that drive the "generating…" UX.
- Key components: `DashboardPage` (prompt input + scene list + video preview), `SceneEditor` / `SceneCodeViewer` (edit narration or the raw Manim code via Monaco editor), `VideoPlayer`, `ProgressBar`, `AdminPage`.

---

## 8. Two special "modes" worth knowing

1. **Test storyboard** (`POST /api/storyboard/test`): creates a storyboard with **hardcoded, known-good Manim scripts** (Pythagorean theorem, a linear graph, etc.) — **uses zero AI credits**. Great for testing the render/assembly pipeline in isolation.
2. **Demo clone** (the "suggestion" cards on the dashboard): when a user picks a pre-made example prompt, the server **clones a pre-rendered storyboard** into their account instead of calling the LLM/renderer. The code and final video are copied lazily as they click through. From the user's view it's indistinguishable from a real generation, but it's instant and free. Controlled by `demoSourceId` on the storyboard.

---

## 9. Deployment

- **Client** → Vercel/Netlify (static SPA). `vercel.json` present.
- **Server** → Render.com web service (Node). `render.yaml` blueprint provisions it.
- **Renderer** → Render.com **private service** (Docker image with Python + Manim + FFmpeg + LaTeX + Piper). Only the API server can reach it over Render's internal network (`RENDERER_URL=http://cognito-stream-renderer:5000`).
- **Database** → hosted Postgres (Supabase). **Auth + file storage** → Supabase.
- Local dev uses `docker-compose.yml` to run everything together.

---

## 10. Likely interview questions & crisp answers

**Q: Walk me through what happens when a user submits a prompt.**
A: JWT-authenticated `POST /api/storyboard` → LLM generates a scene-by-scene storyboard (JSON) → persisted to Postgres → background pipeline starts → per scene: LLM writes Manim code → renderer validates (AST/lint) and renders → on failure, LLM corrects and we retry (≤3×) → Piper generates narration → FFmpeg stitches audio+video → all scenes concatenated into a final MP4 → uploaded to Supabase → storyboard marked `completed`. The client polls for status throughout.

**Q: How do you make an LLM produce code that actually runs?**
A: Layered defense — (1) a detailed system prompt enumerating valid Manim APIs, (2) deterministic auto-fix transforms for common hallucinations, (3) static validation that throws *before* rendering, (4) renderer-side AST + flake8 gates, and most importantly (5) a **feedback-correction loop**: the renderer returns structured errors, we hand them back to the LLM (rotating providers), and retry up to 3 times. We also lower temperature on the first attempt and raise it on retries to escape stuck patterns.

**Q: What if the LLM provider is down or rate-limited?**
A: A 3-tier cascade (OpenRouter → Gemini → Groq) with per-provider cooldowns. A quota/auth/5xx error trips a 30-min cooldown and routes to the next tier transparently. Code-gen retries also force provider rotation for diversity.

**Q: How do you handle concurrency / why isn't it slow?**
A: A rolling worker pool processes up to 6 scenes simultaneously, refilling as scenes complete — so a 6-scene video renders about as fast as one scene. Renders are the bottleneck (~30–60s each), so parallelizing them is the big win.

**Q: How is the long-running render reported to the user?**
A: The create/render endpoints return immediately with `status: processing` and run the pipeline fire-and-forget. The client polls `GET /api/storyboard/:id` every few seconds until `completed`/`failed`. (A `RenderJob` table exists as scaffolding for moving to a real async queue.)

**Q: How does auth work?**
A: Supabase issues JWTs on login; the client attaches them as Bearer tokens; the server verifies them with the shared JWT secret (HS256 via `jose`), upserts a local `User` row mirroring the Supabase UUID, and attaches `req.user`. Admin routes additionally check `role === 'ADMIN'`.

**Q: Why three separate services instead of one?**
A: Different runtimes and scaling needs — Manim/FFmpeg are heavy and need a big-RAM Python container; the API is light Node; the client is static. Decoupling lets each scale and deploy independently, and keeps the renderer private (only the API reaches it).

**Q: How do you keep narration consistent across scenes?**
A: As each scene completes, a short summary is appended to a running context that's fed into later scenes' code-gen prompts — so notation, variable names, and examples stay coherent across the whole video.

**Q: How do you keep costs/credits down?**
A: Pre-render static validation avoids paying for renders that would crash; a "test" mode uses hardcoded code (no AI); demo prompts clone pre-rendered videos instead of generating; per-scene intermediates are deleted after assembly; default render quality is low (854×480) for speed.

**Q: What's the security model on the renderer?**
A: Generated code runs in a subprocess; the legacy operation mode uses a `SAFE_GLOBALS` whitelist + a blacklist that rejects dangerous tokens (`import`, `exec`, `os.`, `subprocess`, dunders, `lambda`). Renders have a 5-minute timeout. The renderer is a private service unreachable from the public internet.

---

## 11. Honest "gotchas" / talking points (shows depth)

- **Naming debt:** `gemini.ts` is now multi-provider; `elevenlabs.ts` actually drives Piper TTS. Be ready to explain these as migration artifacts.
- **Fire-and-forget pipeline:** simple and works, but if the server restarts mid-render, in-flight work is lost — a durable job queue (the `RenderJob` table hints at this) would be the next step.
- **Cooldowns are in-memory:** they reset on server restart and aren't shared across instances — fine for a single instance, would need Redis to scale horizontally.
- **The correction loop is bounded** (3 attempts) — some scenes can still fail; the storyboard is marked `completed` if *any* scenes succeeded (partial success is usable), `failed` only if all fail.

---

### TL;DR for the interview
> "It's a prompt-to-video pipeline. The interesting engineering is making LLMs reliably emit runnable Manim animation code — I do that with layered static validation plus a render-error feedback loop that lets the LLM debug its own code — and orchestrating a parallel, failure-tolerant pipeline across a Node API and a Python renderer, with a multi-provider LLM fallback so free-tier rate limits never take the system down."
