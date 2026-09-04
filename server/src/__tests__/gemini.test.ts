// ==========================================
// GEMINI SERVICE TESTS
// server/src/services/__tests__/gemini.test.ts
// ==========================================

import { generateStoryboard } from '../services/gemini';
import {
  estimateNarrationSeconds,
  NARRATION_TIMING_BOUNDS,
} from '../lib/narrationTiming';

const { MIN_SECONDS, MAX_SECONDS } = NARRATION_TIMING_BOUNDS;

describe('Gemini Service', () => {
  it('should generate a valid storyboard', async () => {
    const prompt = 'Create an educational video about photosynthesis';

    const storyboard = await generateStoryboard(prompt);

    expect(storyboard).toHaveProperty('title');
    expect(storyboard).toHaveProperty('description');
    expect(storyboard).toHaveProperty('scenes');
    expect(Array.isArray(storyboard.scenes)).toBe(true);
    expect(storyboard.scenes.length).toBeGreaterThan(0);

    // Validate first scene
    const firstScene = storyboard.scenes[0];
    expect(firstScene).toHaveProperty('id');
    expect(firstScene).toHaveProperty('narration');
    expect(firstScene).toHaveProperty('visualDescription');
    expect(firstScene).toHaveProperty('manimOperations');
    expect(firstScene).toHaveProperty('estimatedDuration');
    expect(Array.isArray(firstScene.manimOperations)).toBe(true);
  }, 30000); // Increase timeout for AI generation

  // Skipped: structurally cannot pass. The Gemini clients are constructed at
  // module load from GEMINI_API_KEY_PRIMARY / _SECONDARY, so mutating
  // process.env mid-test has no effect — the call goes out on the real key,
  // succeeds, and the assertion fails. Left visible rather than deleted
  // because the behaviour IS worth covering; doing so needs the key wired in
  // as a parameter, or jest.resetModules() with the env set beforehand.
  it.skip('should handle API errors gracefully', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'invalid-key';

    await expect(generateStoryboard('Test prompt')).rejects.toThrow();

    process.env.GEMINI_API_KEY = originalKey;
  });

  it('should validate generated storyboard structure', async () => {
    const storyboard = await generateStoryboard(
      'Brief video about gravity'
    );

    // Check that all scenes have required fields
    storyboard.scenes.forEach((scene) => {
      expect(scene.narration.length).toBeGreaterThan(0);
      expect(scene.narration.length).toBeLessThan(1001);

      // manimOperations is intentionally empty here — planning produces
      // narration + visual description only, and the Python is written later
      // by generateManimSceneCode(). The old `.length > 0` assertion predates
      // that split.
      expect(Array.isArray(scene.manimOperations)).toBe(true);

      // Duration is derived from how long the narration takes to speak, so a
      // 50-word scene is legitimately ~20s. The old `< 16` ceiling encoded the
      // hardcoded 5s budget that made long scenes freeze on their last frame.
      expect(scene.estimatedDuration).toBeGreaterThanOrEqual(MIN_SECONDS);
      expect(scene.estimatedDuration).toBeLessThanOrEqual(MAX_SECONDS);
      expect(scene.estimatedDuration).toBe(
        estimateNarrationSeconds(scene.narration)
      );
    });
  }, 30000);
});