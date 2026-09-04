/**
 * Final-video assembly.
 *
 * Extracted from the storyboard route so it can be called from more than one
 * place. It previously ran only at the end of a full pipeline run, which meant
 * a scene retried afterwards never reached the finished video: the scene row
 * was updated, `finalVideoUrl` still pointed at the old cut, and — because the
 * dashboard stops polling once that URL is set — the user kept watching a
 * video missing the very scene they had just fixed.
 */

import { prisma } from '../lib/prisma';
import { assembleVideo, deleteFinalVideo } from './renderer';

export interface AssemblyOutcome {
  /** 'incomplete' = the renderer found fewer scene files than the DB expects. */
  status: 'completed' | 'failed' | 'incomplete';
  videoUrl?: string;
  totalDuration?: number;
  /** Scenes actually stitched into the video. */
  sceneCount?: number;
  /** Scenes the database expected to be stitched. */
  expectedSceneCount?: number;
  error?: string;
}

/**
 * Stitch every completed scene into the final video and record it on the
 * storyboard. Safe to call repeatedly — it always rebuilds from the scenes
 * currently marked completed, so it doubles as the "re-assemble after a
 * retry" path.
 */
export async function assembleStoryboard(
  storyboardId: string
): Promise<AssemblyOutcome> {
  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    select: { title: true, finalVideoUrl: true },
  });
  if (!storyboard) {
    return { status: 'failed', error: `Storyboard not found: ${storyboardId}` };
  }
  const existingVideoUrl = storyboard.finalVideoUrl;

  const completedScenes = await prisma.scene.findMany({
    where: { storyboardId, status: 'completed', videoUrl: { not: null } },
    orderBy: { sceneNumber: 'asc' },
  });

  if (completedScenes.length === 0) {
    const total = await prisma.scene.count({ where: { storyboardId } });
    console.log('⚠️ No scenes rendered successfully');
    await prisma.storyboard.update({
      where: { id: storyboardId },
      data: {
        status: 'failed',
        errorMessage: `All ${total} scene(s) failed to render. See per-scene errors for details.`,
      },
    });
    return { status: 'failed', error: 'no completed scenes' };
  }

  console.log(`🎞️ Assembling final video from ${completedScenes.length} scenes...`);

  try {
    const assemblyResult = await assembleVideo(
      storyboardId,
      completedScenes.map((s) => ({
        videoUrl: s.videoUrl!,
        audioUrl: s.audioUrl || '',
        duration: s.actualDuration || s.estimatedDuration,
        sceneNumber: s.sceneNumber,
      })),
      'medium',
      storyboard.title || ''
    );

    // The renderer reports how many scene files it actually stitched. Fewer
    // than expected means some per-scene mp4s were missing from disk — the
    // resulting video silently drops those scenes.
    //
    // This is not hypothetical: assembly used to delete per-scene files once
    // the final video shipped, so a later rebuild found only the scenes
    // rendered since, and replaced a good video with a one-scene stub. The
    // files are retained now, but a missing input must never be able to
    // downgrade a video that already exists.
    const assembled = assemblyResult.scenesCount ?? completedScenes.length;
    if (assembled < completedScenes.length) {
      const message =
        `Assembly stitched only ${assembled} of ${completedScenes.length} completed scenes — ` +
        'per-scene video files are missing from the renderer.';

      if (existingVideoUrl) {
        // There is a usable video already. Keep it: an incomplete rebuild is
        // strictly worse than the cut the viewer has now.
        console.error(`❌ ${message} Keeping the existing video.`);
        return {
          status: 'incomplete',
          sceneCount: assembled,
          expectedSceneCount: completedScenes.length,
          error: message,
        };
      }
      // Nothing to fall back to — a partial video beats no video, but say so.
      console.warn(`⚠️  ${message} Publishing it anyway (no previous video to keep).`);
    }

    await prisma.storyboard.update({
      where: { id: storyboardId },
      data: {
        finalVideoUrl: assemblyResult.videoUrl,
        totalDuration: assemblyResult.totalDuration,
        status: 'completed',
        errorMessage: null,
      },
    });

    console.log(`🎉 Final video ready (${assembled} scenes): ${assemblyResult.videoUrl}`);
    return {
      status: 'completed',
      videoUrl: assemblyResult.videoUrl,
      totalDuration: assemblyResult.totalDuration,
      sceneCount: assembled,
      expectedSceneCount: completedScenes.length,
    };
  } catch (assemblyError) {
    const msg = assemblyError instanceof Error ? assemblyError.message : 'Unknown error';
    console.error('❌ Final video assembly failed:', msg);
    await prisma.storyboard.update({
      where: { id: storyboardId },
      data: {
        status: 'failed',
        errorMessage: `Final assembly failed: ${msg}`.slice(0, 2000),
      },
    });
    return { status: 'failed', error: msg };
  }
}

/**
 * Rebuild the final video after a single scene changed.
 *
 * Order is deliberate: **assemble first, delete second.**
 *
 *   1. Flag the storyboard `processing`, keeping the old `finalVideoUrl` so
 *      the viewer keeps watching the current cut while the rebuild runs.
 *   2. Assemble every completed scene into a new video. On success this writes
 *      the new URL; on failure or an incomplete result it writes nothing.
 *   3. Only once a good new video exists, delete the old object from storage.
 *
 * An earlier version deleted first and assembled second, which meant a failed
 * rebuild left the storyboard with no video at all — and an *incomplete* one
 * silently replaced a full video with a shorter one. Deleting last makes the
 * worst case "nothing changed".
 *
 * The delete is skipped when the new video landed on the same storage path,
 * since the upload already overwrote it in place.
 */
export async function rebuildFinalVideo(storyboardId: string): Promise<AssemblyOutcome> {
  const before = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    select: { finalVideoUrl: true, totalDuration: true, status: true },
  });
  const previousUrl = before?.finalVideoUrl ?? null;

  console.log(`🔁 Scene changed — rebuilding final video for ${storyboardId}`);

  await prisma.storyboard.update({
    where: { id: storyboardId },
    data: { status: 'processing' },
  });

  const outcome = await assembleStoryboard(storyboardId);

  if (outcome.status !== 'completed') {
    // Put the storyboard back the way it was — it still has its old video.
    await prisma.storyboard.update({
      where: { id: storyboardId },
      data: {
        status: previousUrl ? 'completed' : 'failed',
        finalVideoUrl: previousUrl,
        totalDuration: before?.totalDuration ?? null,
      },
    });
    console.error(
      `❌ Rebuild did not produce a usable video (${outcome.status}). ` +
      `${previousUrl ? 'Existing video left in place.' : 'No video available.'}`
    );
    return outcome;
  }

  // New video is live in the database. Now the old object is safe to remove.
  if (previousUrl && previousUrl !== outcome.videoUrl) {
    await deleteFinalVideo(previousUrl);
  }

  return outcome;
}
