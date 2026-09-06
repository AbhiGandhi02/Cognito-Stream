// ==========================================
// PRE-NARRATION — ensureSceneAudio / narrateStoryboard
// ==========================================
//
// These cover the write half of the timing-budget contract. The read half
// (routes/scene.ts deriving the code-gen budget from audioUrl + actualDuration)
// already existed, but nothing wrote actualDuration before a render finished,
// so every scene was coded against a word-count estimate instead of its real
// narration length.

const sceneUpdate = jest.fn().mockResolvedValue({});
const sceneFindMany = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    scene: {
      update: (...a: any[]) => sceneUpdate(...a),
      findMany: (...a: any[]) => sceneFindMany(...a),
    },
    storyboard: { update: jest.fn().mockResolvedValue({}) },
    $disconnect: jest.fn().mockResolvedValue(undefined),
  },
}));

const generateAudio = jest.fn();
jest.mock('../services/elevenlabs', () => ({
  generateAudio: (...a: any[]) => generateAudio(...a),
}));

import { ensureSceneAudio, narrateStoryboard } from '../services/orchestrator';

beforeEach(() => {
  sceneUpdate.mockClear();
  sceneFindMany.mockClear();
  generateAudio.mockReset();
});

describe('ensureSceneAudio', () => {
  it('persists BOTH audioUrl and the measured actualDuration', async () => {
    generateAudio.mockResolvedValue({ audioUrl: '/audio/s1.mp3', duration: 12.25, characterCount: 200 });

    const result = await ensureSceneAudio(
      { id: 's1', narration: 'forty words of narration', audioUrl: null, actualDuration: null },
      'Scene 1'
    );

    expect(result).toEqual({ audioUrl: '/audio/s1.mp3', duration: 12.25, characterCount: 200 });
    expect(sceneUpdate).toHaveBeenCalledTimes(1);
    expect(sceneUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: 's1' },
      data: { audioUrl: '/audio/s1.mp3', actualDuration: 12.25 },
    });
  });

  it('reuses existing audio instead of re-synthesising', async () => {
    const result = await ensureSceneAudio(
      { id: 's1', narration: 'n', audioUrl: '/audio/s1.mp3', actualDuration: 9.4 },
      'Scene 1'
    );

    expect(result).toEqual({ audioUrl: '/audio/s1.mp3', duration: 9.4 });
    expect(generateAudio).not.toHaveBeenCalled();
    expect(sceneUpdate).not.toHaveBeenCalled();
  });

  it('re-synthesises a scene that has a file but no measured duration', async () => {
    generateAudio.mockResolvedValue({ audioUrl: '/audio/s1.mp3', duration: 8, characterCount: 1 });
    await ensureSceneAudio({ id: 's1', narration: 'n', audioUrl: '/audio/s1.mp3', actualDuration: null }, 'Scene 1');
    expect(generateAudio).toHaveBeenCalledTimes(1);
  });

  it('re-synthesises when forced, e.g. after the narration text changed', async () => {
    generateAudio.mockResolvedValue({ audioUrl: '/audio/s1.mp3', duration: 7.1, characterCount: 1 });
    await ensureSceneAudio(
      { id: 's1', narration: 'new text', audioUrl: '/audio/s1.mp3', actualDuration: 9.4 },
      'Scene 1',
      true
    );
    expect(generateAudio).toHaveBeenCalledTimes(1);
    expect(sceneUpdate.mock.calls[0][0].data.actualDuration).toBe(7.1);
  });

  it('degrades to a zero-duration result when TTS throws, without writing or throwing', async () => {
    generateAudio.mockRejectedValue(new Error('Renderer service is not running'));

    const result = await ensureSceneAudio(
      { id: 's1', narration: 'n', audioUrl: null, actualDuration: null },
      'Scene 1'
    );

    expect(result).toEqual({ audioUrl: '', duration: 0 });
    expect(sceneUpdate).not.toHaveBeenCalled();
  });
});

describe('narrateStoryboard', () => {
  it('narrates every un-narrated scene and skips the ones already voiced', async () => {
    sceneFindMany.mockResolvedValue([
      { id: 'a', sceneNumber: 1, narration: 'one', audioUrl: '/audio/a.mp3', actualDuration: 10 },
      { id: 'b', sceneNumber: 2, narration: 'two', audioUrl: null, actualDuration: null },
      { id: 'c', sceneNumber: 3, narration: 'three', audioUrl: null, actualDuration: null },
    ]);
    generateAudio.mockImplementation(async (_t: string, id: string) => ({
      audioUrl: `/audio/${id}.mp3`, duration: 11, characterCount: 1,
    }));

    await narrateStoryboard('sb1');

    expect(generateAudio).toHaveBeenCalledTimes(2);
    expect(generateAudio.mock.calls.map((c) => c[1]).sort()).toEqual(['b', 'c']);
  });

  it('never throws when the lookup fails — creation must not be blocked by TTS', async () => {
    sceneFindMany.mockRejectedValue(new Error('db down'));
    await expect(narrateStoryboard('sb1')).resolves.toBeUndefined();
  });
});
