import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { generateAudio } from '../services/elevenlabs';
import { triggerRenderer } from '../services/renderer';
import { generateManimSceneCode } from '../services/gemini';
import { validateRequest } from '../middleware/validation';
import { asyncHandler } from '../middleware/asyncHandler';
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

    // If narration or code changed, reset status and clear URLs
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

    // Build a previous-scenes context summary so the LLM keeps continuity
    // (same example arrays, variables, equations across scenes).
    const previousSceneContext = scene.storyboard.scenes
      .filter((s) => s.sceneNumber < scene.sceneNumber)
      .map(
        (s) =>
          `Scene ${s.sceneNumber} ("${s.visualDescription.slice(0, 80)}"): ${s.narration.slice(0, 200)}`
      )
      .join('\n');

    console.log(`🎨 Generating Manim code for scene ${scene.sceneNumber}: "${scene.visualDescription.slice(0, 50)}"`);

    const code = await generateManimSceneCode({
      sceneTitle: `Scene ${scene.sceneNumber}`,
      narration: scene.narration,
      visualDescription: scene.visualDescription,
      duration: scene.estimatedDuration,
      sceneNumber: scene.sceneNumber,
      totalScenes: scene.storyboard.scenes.length,
      overallTopic: scene.storyboard.prompt,
      previousSceneContext: previousSceneContext || undefined,
    });

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