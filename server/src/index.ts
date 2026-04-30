import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

console.log('🎙️  TTS provider: Piper (local, via renderer service)');
console.log('🔗 Renderer URL:', process.env.RENDERER_URL || 'http://localhost:5000');

// Import routes
import storyboardRouter from './routes/storyboard';
import sceneRouter from './routes/scene';
import renderRouter from './routes/render';

// ==========================================
// APP SETUP
// ==========================================

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ==========================================
// ROUTES
// ==========================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// LLM health check — probes Gemini + Groq independently and reports cooldown state
app.get('/api/health/llm', async (_req, res) => {
  try {
    const { pingLLMs } = await import('./services/gemini');
    const result = await pingLLMs();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// API Routes
app.use('/api/storyboard', storyboardRouter);
app.use('/api/scene', sceneRouter);
app.use('/api/render', renderRouter);

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
  console.error('❌ Server Error:', err);
  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'Something went wrong',
  });
});

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Cognito Stream API Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📁 Audio files: ${audioPath}`);
});

export default app;