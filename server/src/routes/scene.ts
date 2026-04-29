import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { generateAudio } from '../services/elevenlabs';
import { triggerRenderer } from '../services/renderer';
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

    const scene = await prisma.scene.findUnique({
      where: { id },
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
    const { narration, manimCode, visualDescription } = req.body;

    // Find the scene first to check if it exists
    const existingScene = await prisma.scene.findUnique({
      where: { id },
    });

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
      // Convert to array if string
      const codeArray = Array.isArray(manimCode)
        ? manimCode
        : [manimCode];
      updateData.manimCode = JSON.stringify(codeArray);
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
 * POST /api/scene/:id/process
 * Process a scene (generate audio + render video)
 */
router.post(
  '/:id/process',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { quality = 'medium' } = req.body;

    console.log(`🎬 Processing scene: ${id}`);

    // Get the scene
    const scene = await prisma.scene.findUnique({
      where: { id },
    });

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

    const scene = await prisma.scene.findUnique({
      where: { id },
    });

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
    const { quality = 'medium' } = req.body;

    const scene = await prisma.scene.findUnique({
      where: { id },
    });

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

    await prisma.scene.delete({
      where: { id },
    });

    console.log(`🗑️  Deleted scene: ${id}`);

    res.json({
      success: true,
      message: 'Scene deleted successfully',
    });
  })
);

export default router;