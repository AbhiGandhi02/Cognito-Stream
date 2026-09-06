import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { generateAudio } from '../services/elevenlabs';
import { triggerRenderer } from '../services/renderer';
import { generateManimSceneCode, briefContextFromJson } from '../services/gemini';
import { processScene, ensureSceneAudio } from '../services/orchestrator';
import { rebuildFinalVideo } from '../services/assembly';
import { validateRequest } from '../middleware/validation';
import { asyncHandler } from '../middleware/asyncHandler';
import { resolveSceneDuration, countWords } from '../lib/narrationTiming';
import { buildSceneContext } from '../services/sceneContext';
import { withVideoCost, withRetryCost } from '../services/llmUsage';
import { z } from 'zod';

const router = Router();

/** Safely parse manimCode — handles both JSON arrays and raw Python strings */
function safeParseManimCode(manimCode: string | null): any {
  if (!manimCode) return {};
  try {
    return JSON.parse(manimCode);
  } catch {
    // It's a raw Python string, return as-is
    return manimCode;
  }
}

/**
 * Look up a scene only if its parent storyboard belongs to the given user.
 * Returns null when the scene doesn't exist OR isn't owned by the user —
 * routes treat both cases as 404 to avoid leaking storyboard existence.
 */
async function findOwnedScene(sceneId: string, userId: string, includeStoryboard = false) {
  return prisma.scene.findFirst({
    where: { id: sceneId, storyboard: { userId } },
    include: includeStoryboard
      ? { storyboard: { include: { scenes: { orderBy: { sceneNumber: 'asc' } } } } }
      : undefined,
  });
}

// ==========================================
// VALIDATION SCHEMAS
// ==========================================

const updateSceneSchema = z.object({
  narration: z.string().min(1).max(1000).optional(),
  manimCode: z.union([
    z.string(),
    z.array(z.string()),
  ]).optional(),
  visualDescription: z.string().optional(),
});

// ==========================================
// ROUTES
// ==========================================

/**
 * GET /api/scene/:id
 * Get a specific scene by ID
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const scene = await prisma.scene.findFirst({
      where: { id, storyboard: { userId } },
      include: {
        storyboard: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
    });

    if (!scene) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Scene not found',
      });
    }

    return res.json({
      ...scene,
      manimCode: safeParseManimCode(scene.manimCode),
    });
  })
);

/**
 * PATCH /api/scene/:id
 * Update a scene
 */
router.patch(
  '/:id',
  validateRequest(updateSceneSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;
    const { narration, manimCode, visualDescription } = req.body;

    // Find the scene first to check it exists AND belongs to the user
    const existingScene = await findOwnedScene(id, userId);

    if (!existingScene) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Scene not found',
      });
    }

    // Prepare update data
    const updateData: any = {};

    if (narration !== undefined) {
      updateData.narration = narration;
    }

    if (manimCode !== undefined) {
      // Modern code-mode pipeline expects raw Python source (a single string
      // containing `class GeneratedScene(...)`). Legacy callers may still send
      // an array of operation strings — preserve that shape via JSON.stringify.
      if (Array.isArray(manimCode)) {
        updateData.manimCode = JSON.stringify(manimCode);
      } else {
        updateData.manimCode = manimCode; // raw Python string
      }
    }

    if (visualDescription !== undefined) {
      updateData.visualDescription = visualDescription;
    }

    // If narration or code changed, reset status and clear URLs.
    // Clearing audioUrl AND actualDuration together matters: they are now read
    // as a pair to decide whether a scene has a measured timing budget, so a
    // stale duration left behind would be applied to the new narration.
    if (narration || manimCode) {
      updateData.status = 'pending';
      updateData.audioUrl = null;
      updateData.videoUrl = null;
      updateData.actualDuration = null;
    }

    const updatedScene = await prisma.scene.update({
      where: { id },
      data: updateData,
    });

    console.log(`✏️  Updated scene: ${id}`);

    return res.json({
      ...updatedScene,
      manimCode: safeParseManimCode(updatedScene.manimCode),
    });
  })
);

/**
 * POST /api/scene/:id/generate-code
 * Generate Manim Python code for a single scene via the LLM (no rendering).
 * Saves the generated code into scene.manimCode so the orchestrator's later
 * render call can reuse it (orchestrator skips re-generation when code is present).
 */
router.post(
  '/:id/generate-code',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const scene = await prisma.scene.findFirst({
      where: { id, storyboard: { userId } },
      include: {
        storyboard: {
          include: {
            scenes: { orderBy: { sceneNumber: 'asc' } },
          },
        },
      },
    });

    if (!scene) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Scene not found',
      });
    }

    // Build the previous-scenes context so the LLM keeps continuity. This
    // includes each earlier scene's GENERATED CODE, not just its narration:
    // the example array, colours and notation are chosen by the code
    // generator, so a summary built from planning text alone could never tell
    // this scene what to reuse.
    const previousSceneContext = buildSceneContext(
      scene.storyboard.scenes
        .filter((s) => s.sceneNumber < scene.sceneNumber)
        .map((s) => ({
          sceneNumber: s.sceneNumber,
          narration: s.narration,
          visualDescription: s.visualDescription,
          manimCode: s.manimCode,
        }))
    );

    // ---------------------------------------------------------------
    // Demo clone: if this scene's storyboard was cloned from a demo,
    // serve the source scene's saved manimCode instead of calling the
    // LLM. Same response shape — invisible to the user.
    // ---------------------------------------------------------------
    const demoSourceId: string | null = scene.storyboard.demoSourceId ?? null;
    let code: string;
    if (demoSourceId) {
      const sourceScene = await prisma.scene.findFirst({
        where: { storyboardId: demoSourceId, sceneNumber: scene.sceneNumber },
        select: { manimCode: true },
      });
      if (!sourceScene || !sourceScene.manimCode) {
        return res.status(500).json({
          error: 'Demo Source Missing',
          message: `Demo source scene ${scene.sceneNumber} has no cached code`,
        });
      }
      console.log(`✨ [Demo] Serving cached code for scene ${scene.sceneNumber}`);
      code = sourceScene.manimCode;
    } else {
      console.log(`🎨 Generating Manim code for scene ${scene.sceneNumber}: "${scene.visualDescription.slice(0, 50)}"`);
      // Timing budget: the MEASURED narration length. Narrating first is the
      // whole point of the design — an animation built to a word-count guess
      // either freezes on its last frame while the narrator talks, or gets cut
      // off mid-motion. The estimate is ~3% off on average but up to 20% off on
      // an individual scene, because pauses track punctuation, not word count.
      //
      // Normally a no-op: POST /api/storyboard already pre-narrates in the
      // background, so the audio is usually on disk by the time the user
      // reaches this step. This call covers the race (user clicks Generate Code
      // immediately) and the retry path, and falls back to the estimate if TTS
      // is unavailable.
      const audio = await ensureSceneAudio(scene, `Scene ${scene.sceneNumber}`);
      const targetDuration = resolveSceneDuration(scene.narration, audio.duration);
      console.log(
        `⏱️  [Scene ${scene.sceneNumber}] Timing budget: ${targetDuration}s ` +
        `(${audio.duration > 0 ? `measured audio ${audio.duration.toFixed(1)}s` : 'estimated from word count'})`
      );
      code = await withVideoCost(scene.storyboardId, () => generateManimSceneCode({
        sceneTitle: `Scene ${scene.sceneNumber}`,
        narration: scene.narration,
        visualDescription: scene.visualDescription,
        duration: targetDuration,
        narrationWordCount: countWords(scene.narration),
        sceneNumber: scene.sceneNumber,
        totalScenes: scene.storyboard.scenes.length,
        overallTopic: scene.storyboard.prompt,
        previousSceneContext: previousSceneContext || undefined,
        briefContext: briefContextFromJson(scene.storyboard.brief) || undefined,
      }));
    }

    const updatedScene = await prisma.scene.update({
      where: { id },
      data: {
        manimCode: code,
        // Reset render state — code changed, any prior video is stale.
        status: 'pending',
        videoUrl: null,
        actualDuration: null,
      },
    });

    console.log(`✅ Manim code saved for scene ${scene.sceneNumber} (${code.length} chars)`);

    return res.json({
      ...updatedScene,
      manimCode: updatedScene.manimCode, // raw Python string
    });
  })
);

/**
 * POST /api/scene/:id/regenerate
 * Re-run the full per-scene pipeline (LLM code-gen → render → correction loop → TTS)
 * for a single scene. Intended for retrying failed scenes after the initial
 * batch render — clears any prior errorMessage and rebuilds the scene in place.
 */
router.post(
  '/:id/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;

    const scene = await prisma.scene.findFirst({
      where: { id, storyboard: { userId } },
      include: {
        storyboard: { include: { scenes: { orderBy: { sceneNumber: 'asc' } } } },
      },
    });

    if (!scene) {
      return res.status(404).json({ error: 'Not Found', message: 'Scene not found' });
    }

    // Build the same previous-scene context the batch orchestrator uses, so
    // continuity (example data, colours, notation) is preserved on retry.
    //
    // Not filtered to completed scenes: an earlier scene that failed to render
    // still established what the lesson is talking about, and omitting it made
    // the retry read as though nothing preceded it.
    const previousSceneContext = buildSceneContext(
      scene.storyboard.scenes
        .filter((s) => s.sceneNumber < scene.sceneNumber)
        .map((s) => ({
          sceneNumber: s.sceneNumber,
          narration: s.narration,
          visualDescription: s.visualDescription,
          manimCode: s.manimCode,
        }))
    );

    // Why the previous attempt died. Read BEFORE the wipe below clears it —
    // this is the single most useful thing to tell the model on a retry, and
    // it was previously discarded, so a retry regenerated with no knowledge
    // that it had already failed once.
    const previousFailure = scene.errorMessage
      ? `${scene.errorMessage}`.slice(0, 1500) +
        (scene.correctionAttempts > 0
          ? `\n\n(That attempt already went through ${scene.correctionAttempts} automatic repair pass(es) without success, so a small tweak is unlikely to fix it.)`
          : '')
      : undefined;

    // Wipe stored code + reset state so processScene re-generates from scratch
    // (otherwise the AI-skip optimization would just retry the broken script).
    await prisma.scene.update({
      where: { id },
      data: {
        manimCode: '',
        videoUrl: null,
        audioUrl: null,
        actualDuration: null,
        status: 'pending',
        errorMessage: null,
        correctionAttempts: 0,
      },
    });

    console.log(`🔁 [scene ${scene.sceneNumber}] Regenerating after manual retry...`);

    // Accounted separately from the video's reference price: a retry is
    // remedial spend, and charging it to the video would make the videos that
    // went wrong look like the most expensive ones to produce. Logged in full
    // either way — same token and money breakdown, its own summary block.
    const result = await withRetryCost(scene.storyboardId, scene.sceneNumber, () =>
      processScene(
        {
          id: scene.id,
          sceneNumber: scene.sceneNumber,
          narration: scene.narration,
          visualDescription: scene.visualDescription,
          estimatedDuration: scene.estimatedDuration,
          manimCode: '',
        },
        scene.storyboard.prompt,
        scene.storyboard.title,
        scene.storyboard.scenes.length,
        previousSceneContext,
        previousFailure,
        scene.storyboard.brief,
      )
    );

    // The storyboard's assembled video no longer reflects this scene. Rebuild
    // it in the background — without this the scene row updates but
    // finalVideoUrl still points at the old cut, and the dashboard (which
    // stops polling once that URL is set) keeps showing a video missing the
    // scene the user just fixed.
    if (result.status === 'completed') {
      await rebuildFinalVideo(scene.storyboardId);
    }

    const fresh = await prisma.scene.findUnique({ where: { id } });
    return res.json({ ...fresh, processingResult: result });
  })
);

/**
 * POST /api/scene/:id/process
 * Process a scene (generate audio + render video)
 */
router.post(
  '/:id/process',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;
    const { quality = 'medium' } = req.body;

    console.log(`🎬 Processing scene: ${id}`);

    // Get the scene (ownership-checked)
    const scene = await findOwnedScene(id, userId);

    if (!scene) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Scene not found',
      });
    }

    // Update status to processing
    await prisma.scene.update({
      where: { id },
      data: { status: 'processing' },
    });

    try {
      // Step 1: Generate audio with ElevenLabs
      console.log(`🎙️  Generating audio for scene ${scene.sceneNumber}...`);
      const audioData = await generateAudio(scene.narration, scene.id);

      // Update scene with audio URL and duration
      await prisma.scene.update({
        where: { id },
        data: {
          audioUrl: audioData.audioUrl,
          actualDuration: audioData.duration,
        },
      });

      console.log(`✅ Audio generated: ${audioData.duration}s`);

      // Step 2: Trigger renderer service
      console.log(`🎨 Rendering video for scene ${scene.sceneNumber}...`);
      const manimOperations = safeParseManimCode(scene.manimCode);
      const renderResult = await triggerRenderer(
        scene.id,
        manimOperations,
        audioData.duration,
        quality
      );

      console.log(`✅ Video rendered: ${renderResult.videoUrl}`);

      // Step 3: Update scene with final results
      const completedScene = await prisma.scene.update({
        where: { id },
        data: {
          videoUrl: renderResult.videoUrl,
          status: 'completed',
        },
      });

      console.log(`✅ Scene ${scene.sceneNumber} completed successfully`);

      // This scene's video changed — the assembled cut is now stale.
      await rebuildFinalVideo(scene.storyboardId);

      return res.json({
        ...completedScene,
        manimCode: safeParseManimCode(completedScene.manimCode),
      });

    } catch (error) {
      console.error(`❌ Error processing scene ${id}:`, error);

      // Update scene status to failed
      await prisma.scene.update({
        where: { id },
        data: {
          status: 'failed',
        },
      });

      throw error;
    }
  })
);

/**
 * POST /api/scene/:id/regenerate-audio
 * Regenerate only the audio for a scene
 */
router.post(
  '/:id/regenerate-audio',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const scene = await findOwnedScene(id, userId);

    if (!scene) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Scene not found',
      });
    }

    console.log(`🎙️  Regenerating audio for scene ${scene.sceneNumber}...`);

    try {
      const audioData = await generateAudio(scene.narration, scene.id);

      const updatedScene = await prisma.scene.update({
        where: { id },
        data: {
          audioUrl: audioData.audioUrl,
          actualDuration: audioData.duration,
          status: 'pending', // Need to re-render video with new audio
          videoUrl: null,
        },
      });

      return res.json({
        ...updatedScene,
        manimCode: safeParseManimCode(updatedScene.manimCode),
      });

    } catch (error) {
      console.error(`❌ Error regenerating audio:`, error);
      throw error;
    }
  })
);

/**
 * POST /api/scene/:id/regenerate-video
 * Regenerate only the video for a scene (keeps existing audio)
 */
router.post(
  '/:id/regenerate-video',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;
    const { quality = 'medium' } = req.body;

    const scene = await findOwnedScene(id, userId);

    if (!scene) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Scene not found',
      });
    }

    if (!scene.audioUrl || !scene.actualDuration) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Scene must have audio generated first',
      });
    }

    console.log(`🎨 Regenerating video for scene ${scene.sceneNumber}...`);

    try {
      await prisma.scene.update({
        where: { id },
        data: { status: 'processing' },
      });

      const manimOperations = safeParseManimCode(scene.manimCode);
      const renderResult = await triggerRenderer(
        scene.id,
        manimOperations,
        scene.actualDuration,
        quality
      );

      const updatedScene = await prisma.scene.update({
        where: { id },
        data: {
          videoUrl: renderResult.videoUrl,
          status: 'completed',
        },
      });

      // This scene's video changed — the assembled cut is now stale.
      await rebuildFinalVideo(scene.storyboardId);

      return res.json({
        ...updatedScene,
        manimCode: safeParseManimCode(updatedScene.manimCode),
      });

    } catch (error) {
      console.error(`❌ Error regenerating video:`, error);

      await prisma.scene.update({
        where: { id },
        data: { status: 'failed' },
      });

      throw error;
    }
  })
);

/**
 * DELETE /api/scene/:id
 * Delete a scene
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const owned = await findOwnedScene(id, userId);
    if (!owned) {
      return res.status(404).json({ error: 'Not Found', message: 'Scene not found' });
    }

    await prisma.scene.delete({
      where: { id },
    });

    console.log(`🗑️  Deleted scene: ${id}`);

    return res.json({
      success: true,
      message: 'Scene deleted successfully',
    });
  })
);

export default router;