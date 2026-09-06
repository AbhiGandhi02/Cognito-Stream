/**
 * TTS service — generates audio via the renderer's /tts endpoint
 * (local Piper TTS, no external API key required).
 */

import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { estimateNarrationSeconds } from '../lib/narrationTiming';

const execAsync = promisify(exec);

// ==========================================
// TYPES
// ==========================================

interface TTSResponse {
  audioUrl: string;
  duration: number;
  characterCount: number;
}

// Accepted for backwards compatibility — Piper exposes its own voice tuning
// via voice models, so per-call settings are ignored.
interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

// ==========================================
// CONFIGURATION
// ==========================================

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'audio');
const TTS_TIMEOUT = 120000; // 2 minutes — Piper is fast but model load can be slow on first call

function getRendererUrl(): string {
  return process.env.RENDERER_URL || 'http://localhost:5000';
}

// ==========================================
// MAIN FUNCTION
// ==========================================

export async function generateAudio(
  text: string,
  sceneId: string,
  _voiceSettings?: VoiceSettings
): Promise<TTSResponse> {
  console.log(`🎙️  Generating audio for scene: ${sceneId}`);
  console.log(`📝 Text length: ${text.length} characters`);

  // Validate inputs (preserved from previous behavior — tests rely on these)
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }
  if (text.length > 5000) {
    throw new Error('Text too long (max 5000 characters)');
  }

  const rendererUrl = getRendererUrl();
  console.log(`📡 POST ${rendererUrl}/tts`);

  try {
    const response = await axios.post(
      `${rendererUrl}/tts`,
      { sceneId, text },
      {
        timeout: TTS_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          // The renderer rejects unauthenticated requests when its shared
          // secret is configured; /tts is protected alongside /render-code.
          ...(process.env.RENDERER_SHARED_SECRET
            ? { 'X-Renderer-Token': process.env.RENDERER_SHARED_SECRET }
            : {}),
        },
      }
    );

    if (!response.data?.success) {
      throw new Error(response.data?.error || 'TTS request failed');
    }

    const duration: number = response.data.duration ?? 0;
    console.log(`✅ Audio saved: ${sceneId}.mp3 (${duration.toFixed(2)}s)`);

    return {
      audioUrl: response.data.audioUrl || `/audio/${sceneId}.mp3`,
      duration,
      characterCount: text.length,
    };
  } catch (error) {
    let errorMessage = 'Unknown error';
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Renderer service is not running (cannot reach /tts)';
      } else {
        const status = error.response?.status;
        const body = error.response?.data;
        errorMessage = `Renderer /tts HTTP ${status}: ${
          typeof body === 'string' ? body : JSON.stringify(body)
        }`;
      }
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    console.error(`⚠️ Audio generation failed: ${errorMessage}`);
    console.log('💡 Continuing without audio - video will use estimated duration');

    // Graceful fallback: video pipeline still proceeds. Uses the same
    // word-count estimate as the timing budget, so a TTS outage degrades to
    // one consistent number instead of two that disagree.
    const estimatedDuration = estimateNarrationSeconds(text);
    return {
      audioUrl: '',
      duration: estimatedDuration,
      characterCount: text.length,
    };
  }
}

// ==========================================
// LOCAL AUDIO FILE MANAGEMENT
// ==========================================

async function getAudioDuration(filepath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filepath}"`
    );
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration) || duration <= 0) {
      throw new Error('Invalid duration from ffprobe');
    }
    return Math.round(duration * 10) / 10;
  } catch {
    // Fallback: estimate from file size assuming ~128 kbps MP3
    const stats = await fs.stat(filepath);
    const fileSizeKB = stats.size / 1024;
    return Math.round(((fileSizeKB * 8) / 128) * 10) / 10;
  }
}

export async function deleteAudio(sceneId: string): Promise<void> {
  const filepath = path.join(STORAGE_DIR, `${sceneId}.mp3`);
  try {
    await fs.unlink(filepath);
    console.log(`🗑️  Deleted audio file: ${sceneId}.mp3`);
  } catch (error) {
    if ((error as any).code !== 'ENOENT') {
      console.error('Error deleting audio file:', error);
      throw error;
    }
  }
}

export async function getAudioInfo(sceneId: string): Promise<{
  exists: boolean;
  size?: number;
  duration?: number;
}> {
  const filepath = path.join(STORAGE_DIR, `${sceneId}.mp3`);
  try {
    const stats = await fs.stat(filepath);
    const duration = await getAudioDuration(filepath);
    return { exists: true, size: stats.size, duration };
  } catch {
    return { exists: false };
  }
}

export async function cleanupOldAudioFiles(daysOld: number = 7): Promise<number> {
  const cutoffDate = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  const files = await fs.readdir(STORAGE_DIR);

  let deletedCount = 0;
  for (const file of files) {
    const filepath = path.join(STORAGE_DIR, file);
    const stats = await fs.stat(filepath);
    if (stats.mtimeMs < cutoffDate) {
      await fs.unlink(filepath);
      deletedCount++;
    }
  }

  console.log(`🧹 Cleaned up ${deletedCount} old audio files`);
  return deletedCount;
}

// ==========================================
// BATCH OPERATIONS
// ==========================================

export async function generateAudioBatch(
  scenes: Array<{ id: string; text: string }>
): Promise<TTSResponse[]> {
  console.log(`🎙️  Batch generating audio for ${scenes.length} scenes`);

  const results: TTSResponse[] = [];
  const errors: Array<{ sceneId: string; error: string }> = [];

  for (const scene of scenes) {
    try {
      const result = await generateAudio(scene.text, scene.id);
      results.push(result);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Error generating audio for ${scene.id}:`, error);
      errors.push({
        sceneId: scene.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  if (errors.length > 0) {
    console.warn(`⚠️  ${errors.length} scenes failed to generate audio`);
  }

  return results;
}

// ==========================================
// EXPORT
// ==========================================

export default {
  generateAudio,
  deleteAudio,
  getAudioInfo,
  cleanupOldAudioFiles,
  generateAudioBatch,
};
