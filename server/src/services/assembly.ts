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
import { assembleVideo, deleteFinalVideo, deleteStorageObjects } from './renderer';
import { logVideoCost } from './llmUsage';

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
    // A total failure still spent real money on planning and code generation.
    logVideoCost(storyboardId, { title: `${storyboard.title || storyboardId} (FAILED)`, scenes: 0 });
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
      undefined,   // use the configured RENDER_QUALITY, not a hardcoded tier
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

    // The only moment this video's LLM spend is actually complete: the brief,
    // the scene plan, every code-generation request and every repair have all
    // landed. Prints once, then stops tracking the storyboard.
    logVideoCost(storyboardId, {
      title: storyboard.title || storyboardId,
      scenes: assembled,
      durationSec: assemblyResult.totalDuration ?? null,
    });

    const outcome: AssemblyOutcome = {
      status: 'completed',
      videoUrl: assemblyResult.videoUrl,
      totalDuration: assemblyResult.totalDuration,
      sceneCount: assembled,
      expectedSceneCount: completedScenes.length,
    };

    // Ordered deliberately: the storyboard row above already points at the new
    // video, so if anything here dies the worst case is intermediates left on
    // disk — never a storyboard whose video was deleted out from under it.
    await pruneSceneArtifacts(storyboardId, outcome);

    return outcome;
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
 * Drop the per-scene intermediates once the finished video no longer needs
 * them.
 *
 * The durable artifact for a scene is its `manimCode` row, not its mp4 — a
 * scene can always be re-rendered from the code, and re-clicking "Render Final
 * Video" already re-renders every scene. So once a complete video exists, the
 * per-scene videos and narration are disposable, and keeping them roughly
 * doubles storage per video (~6 MB vs ~3 MB).
 *
 * They are kept while ANY scene is failed, because that is exactly when a
 * retry will rebuild the final cut from the scenes that already succeeded, and
 * re-rendering those would be pure waste.
 *
 * Every guard below exists to make sure this can only ever delete something
 * that is genuinely redundant. Best-effort throughout: pruning must never turn
 * a finished video into a failure.
 */
async function pruneSceneArtifacts(
  storyboardId: string,
  outcome: AssemblyOutcome
): Promise<void> {
  try {
    // G1 — only after an assembly that actually produced a video.
    if (outcome.status !== 'completed' || !outcome.videoUrl) return;

    // G2 — the final video must be in durable storage. A relative path means
    // cloud storage is unconfigured (local dev), where the per-scene files on
    // disk are the ONLY copies and deleting them buys nothing.
    if (!/^https?:\/\//.test(outcome.videoUrl)) return;

    // G3 — the renderer must have stitched every scene it was given. A short
    // count means files were missing, which is the opposite of safe to prune.
    if (
      outcome.sceneCount === undefined ||
      outcome.expectedSceneCount === undefined ||
      outcome.sceneCount < outcome.expectedSceneCount
    ) {
      return;
    }

    const scenes = await prisma.scene.findMany({
      where: { storyboardId },
      select: { sceneNumber: true, status: true, videoUrl: true, audioUrl: true },
    });

    // G4 — every scene in the storyboard must be complete. One failed scene
    // means a retry is coming, and that retry needs its siblings' files.
    const unfinished = scenes.filter((sc) => sc.status !== 'completed');
    if (unfinished.length > 0) {
      console.log(
        `🧷 Keeping per-scene files for ${storyboardId} — ` +
        `${unfinished.length} scene(s) not complete (${unfinished.map((s) => s.sceneNumber).join(', ')}).`
      );
      return;
    }

    // G5 — the video we just published must cover every scene that exists,
    // not merely every scene the renderer happened to receive.
    if (outcome.sceneCount < scenes.length) return;

    // G6 — thumbnails are deliberately NOT pruned. They are ~10 KB each and
    // the dashboard's scene breakdown and the landing page posters read them;
    // deleting those would break UI that the scene videos never fed.
    const urls = scenes.flatMap((sc) => [sc.videoUrl, sc.audioUrl]);
    if (urls.every((u) => !u)) return;

    console.log(
      `🧹 Video complete with all ${scenes.length} scenes — removing per-scene ` +
      `videos and narration (final video and thumbnails are kept).`
    );
    await deleteStorageObjects(urls);

    // The DB columns are left pointing at the removed objects ON PURPOSE.
    // assembleStoryboard selects scenes with `videoUrl: { not: null }`, so
    // nulling them would make a later rebuild find zero scenes and mark a
    // perfectly good storyboard failed. Nothing reads these URLs once the
    // final video exists — the dashboard uses thumbnailUrl — and a re-render
    // overwrites them with fresh ones.
  } catch (err) {
    console.warn(
      `⚠️  Per-scene cleanup skipped for ${storyboardId} ` +
      `(${String((err as Error)?.message ?? err).slice(0, 160)}) — the video is unaffected.`
    );
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
