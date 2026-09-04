import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

console.log('🎙️  TTS provider: Piper (local, via renderer service)');
console.log('🔗 Renderer URL:', process.env.RENDERER_URL || 'http://localhost:5000');

// Import routes
import storyboardRouter from './routes/storyboard';
import publicRouter from './routes/public';
import sceneRouter from './routes/scene';
import renderRouter from './routes/render';
import meRouter from './routes/me';
import adminRouter from './routes/admin';
import { requireAuth, requireAdmin } from './middleware/auth';
import { sanitizeUserErrors } from './middleware/sanitizeUserErrors';
import { classifyUserError } from './services/userFacingError';

// ==========================================
// APP SETUP
// ==========================================

const app = express();

// Middleware — restrict CORS to the configured client origin in production.
// In dev (no CLIENT_URL set) we allow everything so localhost:5173 works.
// CLIENT_URL accepts a single origin or comma-separated list.
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  })
);
app.use(express.json());

// ==========================================
// ROUTES
// ==========================================

// Health check — cheap liveness probe. Used as Render's healthCheckPath, so it
// deliberately touches nothing external: a DB hiccup must not get us restarted.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// DB health check — issues a real query so the Postgres connection is exercised.
// This is the one to hit from an external cron: it keeps the Render instance
// awake AND registers activity on Supabase, which pauses idle free projects.
app.get('/health/db', async (_req, res) => {
  const startedAt = Date.now();
  try {
    const { prisma } = await import('./lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      db: 'reachable',
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[health/db] query failed:', err?.message || err);
    res.status(503).json({
      status: 'error',
      db: 'unreachable',
      error: String(err?.message || err),
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  }
});

// LLM health check — probes each Gemini key and reports per-key cooldown state
app.get('/api/health/llm', async (_req, res) => {
  try {
    const { pingLLMs } = await import('./services/gemini');
    const result = await pingLLMs();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Public (no-auth) read endpoints for the landing page demo videos.
app.use('/api/public', sanitizeUserErrors, publicRouter);

// API Routes — all gated behind Supabase JWT verification
app.use('/api/me', requireAuth, meRouter);
// sanitizeUserErrors rewrites raw provider errors (e.g. a Gemini 429 telling
// the viewer to "check your plan and billing details") into user-safe copy.
// Deliberately NOT mounted on /api/admin — admins need the raw text.
app.use('/api/storyboard', requireAuth, sanitizeUserErrors, storyboardRouter);
app.use('/api/scene', requireAuth, sanitizeUserErrors, sceneRouter);
app.use('/api/render', requireAuth, sanitizeUserErrors, renderRouter);
// Admin routes — additionally require ADMIN role
app.use('/api/admin', requireAuth, requireAdmin, adminRouter);

// (POST /api/storyboard/:id/render is now handled by the storyboard router
// in routes/storyboard.ts — it runs the full code-gen + render + assembly
// pipeline. The previous redirect to renderRouter only assembled already-
// rendered scenes, which broke the AnimG-style "Review → Render" flow.)

// Serve audio files
const audioPath = path.join(__dirname, '../../storage/audio');
app.use('/audio', express.static(audioPath));

// Serve video files (local static first, fallback to renderer proxy)
const videoPath = path.join(__dirname, '../../storage/output');
app.use('/video', express.static(videoPath));
app.use('/videos', express.static(videoPath));
console.log(`📁 Video files: ${videoPath}`);

// Fallback: proxy video requests to the renderer service
const RENDERER_URL = process.env.RENDERER_URL || 'http://localhost:5000';
app.get('/videos/:filename', async (req, res) => {
  try {
    const { default: axios } = await import('axios');
    const response = await axios.get(`${RENDERER_URL}/videos/${req.params.filename}`, {
      responseType: 'stream',
      timeout: 30000,
    });
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    response.data.pipe(res);
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// ==========================================
// ERROR HANDLING
// ==========================================

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Full detail to the logs; only the mapped message goes over the wire.
  console.error('❌ Server Error:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.name || 'Internal Server Error',
    message:
      status >= 500
        ? classifyUserError(err?.message).message
        : err.message || 'Something went wrong',
  });
});

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Cognito Stream API Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🗄️  DB health check: http://localhost:${PORT}/health/db`);
  console.log(`📁 Audio files: ${audioPath}`);
});

export default app;