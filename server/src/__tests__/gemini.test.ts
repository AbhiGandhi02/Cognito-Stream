// ==========================================
// GEMINI SERVICE TESTS
// server/src/services/__tests__/gemini.test.ts
// ==========================================

import { generateStoryboard } from '../services/gemini';

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

  it('should handle API errors gracefully', async () => {
    // Temporarily set invalid API key
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'invalid-key';

    await expect(generateStoryboard('Test prompt')).rejects.toThrow();

    // Restore original key
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
      expect(scene.manimOperations.length).toBeGreaterThan(0);
      expect(scene.estimatedDuration).toBeGreaterThan(0);
      expect(scene.estimatedDuration).toBeLessThan(16);
    });
  }, 30000);
});