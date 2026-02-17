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

// API Routes
app.use('/api/storyboard', storyboardRouter);
app.use('/api/scene', sceneRouter);
app.use('/api/render', renderRouter);

// Legacy render endpoint (for backwards compatibility with frontend)
app.post('/api/storyboard/:id/render', async (req, res) => {
  // Redirect to the render router
  req.url = `/storyboard/${req.params.id}`;
  renderRouter(req, res, () => { });
});

// Serve audio files
const audioPath = path.join(__dirname, '../../storage/audio');
app.use('/audio', express.static(audioPath));

// Serve video files
const videoPath = path.join(__dirname, '../../storage/output');
app.use('/video', express.static(videoPath));
console.log(`📁 Video files: ${videoPath}`);

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