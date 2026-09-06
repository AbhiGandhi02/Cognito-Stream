// ==========================================
// PER-SCENE CLEANUP AFTER A COMPLETE VIDEO
// ==========================================
//
// Retention rule: per-scene videos and narration are disposable once a video
// covering EVERY scene exists, because manimCode in the database can always
// re-render them. They are kept while any scene is failed, because that is
// precisely when a retry rebuilds the final cut from its siblings.
//
// These tests exist because the failure mode is silent and unrecoverable:
// deleting one scene too eagerly leaves a storyboard that can never be
// rebuilt, and nothing would report it at the time.

const storyboardFindUnique = jest.fn();
const storyboardUpdate = jest.fn().mockResolvedValue({});
const sceneFindMany = jest.fn();
const sceneCount = jest.fn().mockResolvedValue(3);

jest.mock('../lib/prisma', () => ({
  prisma: {
    storyboard: {
      findUnique: (...a: any[]) => storyboardFindUnique(...a),
      update: (...a: any[]) => storyboardUpdate(...a),
    },
    scene: {
      findMany: (...a: any[]) => sceneFindMany(...a),
      count: (...a: any[]) => sceneCount(...a),
    },
  },
}));

const assembleVideo = jest.fn();
const deleteStorageObjects = jest.fn().mockResolvedValue({ deleted: [], missing: [], failed: [] });
jest.mock('../services/renderer', () => ({
  assembleVideo: (...a: any[]) => assembleVideo(...a),
  deleteFinalVideo: jest.fn().mockResolvedValue({ deleted: [], missing: [], failed: [] }),
  deleteStorageObjects: (...a: any[]) => deleteStorageObjects(...a),
}));
jest.mock('../services/llmUsage', () => ({ logVideoCost: jest.fn() }));

import { assembleStoryboard } from '../services/assembly';

const CLOUD = 'https://x.supabase.co/storage/v1/object/public/cognito-stream/videos/t-abc123.mp4';

const scene = (n: number, status = 'completed') => ({
  id: `s${n}`, sceneNumber: n, status,
  videoUrl: `https://x.supabase.co/storage/v1/object/public/cognito-stream/scenes/s${n}.mp4`,
  audioUrl: `https://x.supabase.co/storage/v1/object/public/cognito-stream/audio/s${n}.mp3`,
  thumbnailUrl: `https://x.supabase.co/storage/v1/object/public/cognito-stream/thumbnails/s${n}.jpg`,
  actualDuration: 10, estimatedDuration: 10,
});

beforeEach(() => {
  jest.clearAllMocks();
  storyboardFindUnique.mockResolvedValue({ title: 'T', finalVideoUrl: null });
  deleteStorageObjects.mockResolvedValue({ deleted: [], missing: [], failed: [] });
});

describe('per-scene cleanup', () => {
  it('prunes scene videos and narration when every scene made it', async () => {
    const all = [scene(1), scene(2), scene(3)];
    sceneFindMany.mockResolvedValue(all);
    assembleVideo.mockResolvedValue({ videoUrl: CLOUD, totalDuration: 30, scenesCount: 3 });

    await assembleStoryboard('sb1');

    expect(deleteStorageObjects).toHaveBeenCalledTimes(1);
    const urls: string[] = deleteStorageObjects.mock.calls[0][0].filter(Boolean);
    expect(urls).toHaveLength(6);                       // 3 videos + 3 audio
    expect(urls.some((u) => u.includes('/scenes/'))).toBe(true);
    expect(urls.some((u) => u.includes('/audio/'))).toBe(true);
    // Thumbnails feed the dashboard breakdown and the landing-page posters.
    expect(urls.some((u) => u.includes('/thumbnails/'))).toBe(false);
  });

  it('keeps everything when a scene failed — a retry will need the siblings', async () => {
    // assembleStoryboard only stitches completed scenes, so the failed one is
    // absent from the assembly, but present in the storyboard.
    sceneFindMany
      .mockResolvedValueOnce([scene(1), scene(2)])                        // for assembly
      .mockResolvedValueOnce([scene(1), scene(2), scene(3, 'failed')]);   // for the prune check
    assembleVideo.mockResolvedValue({ videoUrl: CLOUD, totalDuration: 20, scenesCount: 2 });

    await assembleStoryboard('sb1');

    expect(deleteStorageObjects).not.toHaveBeenCalled();
  });

  it('keeps everything when the renderer stitched fewer files than expected', async () => {
    sceneFindMany.mockResolvedValue([scene(1), scene(2), scene(3)]);
    assembleVideo.mockResolvedValue({ videoUrl: CLOUD, totalDuration: 20, scenesCount: 2 });

    await assembleStoryboard('sb1');

    expect(deleteStorageObjects).not.toHaveBeenCalled();
  });

  it('keeps everything in local dev, where those files are the only copies', async () => {
    sceneFindMany.mockResolvedValue([scene(1), scene(2), scene(3)]);
    assembleVideo.mockResolvedValue({ videoUrl: '/videos/sb1_final.mp4', totalDuration: 30, scenesCount: 3 });

    await assembleStoryboard('sb1');

    expect(deleteStorageObjects).not.toHaveBeenCalled();
  });

  it('never lets a cleanup failure turn a finished video into a failure', async () => {
    sceneFindMany.mockResolvedValue([scene(1), scene(2), scene(3)]);
    assembleVideo.mockResolvedValue({ videoUrl: CLOUD, totalDuration: 30, scenesCount: 3 });
    deleteStorageObjects.mockRejectedValue(new Error('bucket unreachable'));

    const outcome = await assembleStoryboard('sb1');

    expect(outcome.status).toBe('completed');
    expect(outcome.videoUrl).toBe(CLOUD);
  });
});
