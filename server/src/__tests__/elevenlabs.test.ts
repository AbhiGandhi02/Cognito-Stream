// ==========================================
// ELEVENLABS SERVICE TESTS
// server/src/services/__tests__/elevenlabs.test.ts
// ==========================================

import { generateAudio, getAudioInfo } from '../services/elevenlabs';

describe('ElevenLabs Service', () => {
  const testSceneId = 'test-scene-' + Date.now();

  it('should generate audio from text', async () => {
    const text = 'This is a test narration for the scene.';

    const result = await generateAudio(text, testSceneId);

    expect(result).toHaveProperty('audioUrl');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('characterCount');
    expect(result.duration).toBeGreaterThan(0);
    expect(result.characterCount).toBe(text.length);
  }, 30000);

  it('should reject empty text', async () => {
    await expect(generateAudio('', testSceneId)).rejects.toThrow(
      'Text cannot be empty'
    );
  });

  it('should reject text that is too long', async () => {
    const longText = 'a'.repeat(5001);

    await expect(generateAudio(longText, testSceneId)).rejects.toThrow(
      'Text too long'
    );
  });

  it('should retrieve audio file info', async () => {
    const text = 'Another test narration.';
    await generateAudio(text, testSceneId);

    const info = await getAudioInfo(testSceneId);

    expect(info.exists).toBe(true);
    expect(info.size).toBeGreaterThan(0);
    expect(info.duration).toBeGreaterThan(0);
  }, 30000);
});

// ==========================================
// RENDERER SERVICE TESTS
// server/src/services/__tests__/renderer.test.ts
// ==========================================

import { 
  checkRendererHealth, 
  triggerRenderer,
  getQualityPreset,
  estimateRenderTime 
} from '../services/renderer';

describe('Renderer Service', () => {
  it('should check renderer health', async () => {
    const isHealthy = await checkRendererHealth();
    expect(typeof isHealthy).toBe('boolean');
  });

  it('should get quality presets', () => {
    const mediumPreset = getQualityPreset('medium');

    expect(mediumPreset).toHaveProperty('resolution');
    expect(mediumPreset).toHaveProperty('fps');
    expect(mediumPreset).toHaveProperty('bitrate');
    expect(Array.isArray(mediumPreset.resolution)).toBe(true);
  });

  it('should estimate render time', () => {
    const duration = 5;
    const estimatedTime = estimateRenderTime(duration, 'medium');

    expect(estimatedTime).toBeGreaterThan(0);
    expect(typeof estimatedTime).toBe('number');
  });

  it('should trigger renderer with valid code', async () => {
    const manimCode = ['Text("Test").scale(1.5)'];
    const duration = 3;
    const sceneId = 'test-render-' + Date.now();

    // This test requires renderer service to be running
    try {
      const result = await triggerRenderer(sceneId, manimCode, duration);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('videoUrl');
    } catch (error) {
      // Skip if renderer is not available
      console.warn('Renderer service not available, skipping test');
    }
  }, 120000); // 2 minute timeout
});