import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ==========================================
// TYPES
// ==========================================

interface ElevenLabsResponse {
  audioUrl: string;
  duration: number;
  characterCount: number;
}

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
}

// ==========================================
// CONFIGURATION
// ==========================================

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'ErXwobaYiN019PkySvjV';
const STORAGE_DIR = path.join(process.cwd(), 'storage', 'audio');
const BASE_URL = 'https://api.elevenlabs.io/v1';

// Default voice settings for educational content
const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.3,
  use_speaker_boost: true,
};

// ==========================================
// INITIALIZATION
// ==========================================

async function ensureStorageDirectory(): Promise<void> {
  try {
    await fs.access(STORAGE_DIR);
  } catch {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    console.log('📁 Created audio storage directory');
  }
}

// ==========================================
// MAIN FUNCTION
// ==========================================

export async function generateAudio(
  text: string,
  sceneId: string,
  voiceSettings: VoiceSettings = DEFAULT_VOICE_SETTINGS
): Promise<ElevenLabsResponse> {
  console.log(`🎙️  Generating audio for scene: ${sceneId}`);
  console.log(`📝 Text length: ${text.length} characters`);

  // Validate inputs
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  if (text.length > 5000) {
    throw new Error('Text too long (max 5000 characters)');
  }

  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  // Ensure storage directory exists
  await ensureStorageDirectory();

  try {
    // Make API request to ElevenLabs
    const response = await axios.post(
      `${BASE_URL}/text-to-speech/${VOICE_ID}`,
      {
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: voiceSettings,
      },
      {
        headers: {
          Accept: 'audio/mpeg',
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 60000, // 60 second timeout
      }
    );

    // Save audio file
    const filename = `${sceneId}.mp3`;
    const filepath = path.join(STORAGE_DIR, filename);
    await fs.writeFile(filepath, response.data);

    console.log(`✅ Audio saved: ${filename}`);

    // Get actual audio duration using ffprobe
    const duration = await getAudioDuration(filepath);

    console.log(`⏱️  Audio duration: ${duration.toFixed(2)}s`);

    return {
      audioUrl: `/audio/${filename}`,
      duration,
      characterCount: text.length,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.detail?.message || error.message;

      if (status === 401) {
        throw new Error('Invalid ElevenLabs API key');
      } else if (status === 429) {
        throw new Error('ElevenLabs rate limit exceeded');
      } else if (status === 400) {
        throw new Error(`Invalid request: ${message}`);
      } else {
        throw new Error(`ElevenLabs API error: ${message}`);
      }
    }

    throw error;
  }
}

// ==========================================
// AUDIO DURATION CALCULATION
// ==========================================

/**
 * Get actual audio duration using ffprobe
 */
async function getAudioDuration(filepath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filepath}"`
    );

    const duration = parseFloat(stdout.trim());

    if (isNaN(duration) || duration <= 0) {
      throw new Error('Invalid duration from ffprobe');
    }

    return Math.round(duration * 10) / 10; // Round to 1 decimal place
  } catch (error) {
    console.warn('⚠️  ffprobe not available, using estimation');
    return estimateAudioDuration(filepath);
  }
}

/**
 * Estimate audio duration based on file size
 * Fallback method when ffprobe is not available
 */
async function estimateAudioDuration(filepath: string): Promise<number> {
  try {
    const stats = await fs.stat(filepath);
    const fileSizeKB = stats.size / 1024;

    // MP3 bitrate average: ~128 kbps
    // Duration (seconds) = (File size in KB * 8) / bitrate
    const estimatedDuration = (fileSizeKB * 8) / 128;

    return Math.round(estimatedDuration * 10) / 10;
  } catch (error) {
    console.error('Error estimating duration:', error);
    // Last resort: estimate from text length
    return estimateDurationFromText(await fs.readFile(filepath, 'utf-8'));
  }
}

/**
 * Estimate duration from text length
 * Average speaking rate: ~150 words per minute
 */
function estimateDurationFromText(text: string): number {
  const words = text.split(/\s+/).length;
  const wordsPerMinute = 150;
  const minutes = words / wordsPerMinute;
  const seconds = minutes * 60;

  return Math.round(seconds * 10) / 10;
}

// ==========================================
// VOICE MANAGEMENT
// ==========================================

/**
 * Get available voices from ElevenLabs
 */
export async function getAvailableVoices(): Promise<any[]> {
  try {
    const response = await axios.get(`${BASE_URL}/voices`, {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
    });

    return response.data.voices;
  } catch (error) {
    console.error('Error fetching voices:', error);
    throw new Error('Failed to fetch available voices');
  }
}

/**
 * Get voice details
 */
export async function getVoiceDetails(voiceId: string): Promise<any> {
  try {
    const response = await axios.get(`${BASE_URL}/voices/${voiceId}`, {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching voice details:', error);
    throw new Error('Failed to fetch voice details');
  }
}

// ==========================================
// QUOTA MANAGEMENT
// ==========================================

/**
 * Check API quota/usage
 */
export async function checkQuota(): Promise<any> {
  try {
    const response = await axios.get(`${BASE_URL}/user`, {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
    });

    return {
      characterCount: response.data.subscription.character_count,
      characterLimit: response.data.subscription.character_limit,
      remaining:
        response.data.subscription.character_limit -
        response.data.subscription.character_count,
      resetDate: response.data.subscription.next_character_count_reset_unix,
    };
  } catch (error) {
    console.error('Error checking quota:', error);
    throw new Error('Failed to check API quota');
  }
}

// ==========================================
// AUDIO FILE MANAGEMENT
// ==========================================

/**
 * Delete an audio file
 */
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

/**
 * Get audio file info
 */
export async function getAudioInfo(sceneId: string): Promise<{
  exists: boolean;
  size?: number;
  duration?: number;
}> {
  const filepath = path.join(STORAGE_DIR, `${sceneId}.mp3`);

  try {
    const stats = await fs.stat(filepath);
    const duration = await getAudioDuration(filepath);

    return {
      exists: true,
      size: stats.size,
      duration,
    };
  } catch (error) {
    return {
      exists: false,
    };
  }
}

/**
 * Cleanup old audio files
 */
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

/**
 * Generate audio for multiple scenes in batch
 */
export async function generateAudioBatch(
  scenes: Array<{ id: string; text: string }>
): Promise<ElevenLabsResponse[]> {
  console.log(`🎙️  Batch generating audio for ${scenes.length} scenes`);

  const results: ElevenLabsResponse[] = [];
  const errors: Array<{ sceneId: string; error: string }> = [];

  for (const scene of scenes) {
    try {
      const result = await generateAudio(scene.text, scene.id);
      results.push(result);

      // Add delay to respect rate limits (if applicable)
      await new Promise((resolve) => setTimeout(resolve, 500));
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
  getAvailableVoices,
  getVoiceDetails,
  checkQuota,
  deleteAudio,
  getAudioInfo,
  cleanupOldAudioFiles,
  generateAudioBatch,
};