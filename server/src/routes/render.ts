import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { assembleVideo } from '../services/renderer';
import { asyncHandler } from '../middleware/asyncHandler';
import { z } from 'zod';

const router = Router();

// ==========================================
// VALIDATION SCHEMAS
// ==========================================

const renderStoryboardSchema = z.object({
  quality: z.enum(['low', 'medium', 'high', 'ultra']).default('medium'),
});

// ==========================================
// ROUTES
// ==========================================

/**
 * POST /api/render/storyboard/:id
 * Render the complete final video for a storyboard
 */
router.post(
  '/storyboard/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { quality = 'medium' } = req.body;

    console.log(`🎬 Starting final render for storyboard: ${id}`);

    // Get storyboard with all scenes
    const storyboard = await prisma.storyboard.findUnique({
      where: { id },
      include: {
        scenes: {
          orderBy: { sceneNumber: 'asc' },
        },
      },
    });

    if (!storyboard) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Storyboard not found',
      });
    }

    // Check if all scenes are completed
    const incompleteScenes = storyboard.scenes.filter(
      (s) => s.status !== 'completed'
    );

    if (incompleteScenes.length > 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `${incompleteScenes.length} scene(s) are not completed yet`,
        incompleteScenes: incompleteScenes.map((s) => ({
          id: s.id,
          sceneNumber: s.sceneNumber,
          status: s.status,
        })),
      });
    }

    // Check if all scenes have video URLs
    const scenesWithoutVideo = storyboard.scenes.filter(
      (s) => !s.videoUrl
    );

    if (scenesWithoutVideo.length > 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Some scenes are missing video files',
      });
    }

    try {
      // Update storyboard status
      await prisma.storyboard.update({
        where: { id },
        data: { status: 'processing' },
      });

      // Prepare scene data for assembly
      const scenesData = storyboard.scenes.map((scene) => ({
        videoUrl: scene.videoUrl!,
        audioUrl: scene.audioUrl!,
        duration: scene.actualDuration!,
        sceneNumber: scene.sceneNumber,
      }));

      console.log(`🎞️  Assembling ${scenesData.length} scenes...`);

      // Trigger video assembly
      const assembleResult = await assembleVideo(id, scenesData, quality);

      console.log(`✅ Final video assembled: ${assembleResult.videoUrl}`);

      // Update storyboard with final video
      const completedStoryboard = await prisma.storyboard.update({
        where: { id },
        data: {
          finalVideoUrl: assembleResult.videoUrl,
          totalDuration: assembleResult.totalDuration,
          status: 'completed',
        },
        include: {
          scenes: {
            orderBy: { sceneNumber: 'asc' },
          },
        },
      });

      console.log(`🎉 Storyboard completed: ${id}`);

      return res.json({
        ...completedStoryboard,
        scenes: completedStoryboard.scenes.map((scene) => ({
          ...scene,
          manimCode: JSON.parse(scene.manimCode),
        })),
      });
    } catch (error) {
      console.error(`❌ Error rendering storyboard:`, error);

      // Update status to failed
      await prisma.storyboard.update({
        where: { id },
        data: { status: 'failed' },
      });

      throw error;
    }
  })
);

/**
 * POST /api/render/batch
 * Process multiple scenes in batch
 */
router.post(
  '/batch',
  asyncHandler(async (req: Request, res: Response) => {
    const { sceneIds, quality = 'medium' } = req.body;

    if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'sceneIds must be a non-empty array',
      });
    }

    console.log(`🎬 Batch processing ${sceneIds.length} scenes...`);

    const results = [];
    const errors = [];

    for (const sceneId of sceneIds) {
      try {
        // Import scene processing logic
        const { generateAudio } = await import('../services/elevenlabs');
        const { triggerRenderer } = await import('../services/renderer');

        const scene = await prisma.scene.findUnique({
          where: { id: sceneId },
        });

        if (!scene) {
          errors.push({
            sceneId,
            error: 'Scene not found',
          });
          continue;
        }

        // Update status
        await prisma.scene.update({
          where: { id: sceneId },
          data: { status: 'processing' },
        });

        // Generate audio
        const audioData = await generateAudio(scene.narration, scene.id);

        await prisma.scene.update({
          where: { id: sceneId },
          data: {
            audioUrl: audioData.audioUrl,
            actualDuration: audioData.duration,
          },
        });

        // Render video
        const manimOperations = JSON.parse(scene.manimCode);
        const renderResult = await triggerRenderer(
          scene.id,
          manimOperations,
          audioData.duration,
          quality
        );

        // Update with final result
        const completedScene = await prisma.scene.update({
          where: { id: sceneId },
          data: {
            videoUrl: renderResult.videoUrl,
            status: 'completed',
          },
        });

        results.push({
          sceneId,
          status: 'completed',
          scene: completedScene,
        });

        console.log(`✅ Scene ${scene.sceneNumber} completed`);
      } catch (error) {
        console.error(`❌ Error processing scene ${sceneId}:`, error);

        await prisma.scene.update({
          where: { id: sceneId },
          data: { status: 'failed' },
        });

        errors.push({
          sceneId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return res.json({
      success: errors.length === 0,
      processed: results.length,
      failed: errors.length,
      results,
      errors,
    });
  })
);

/**
 * GET /api/render/progress/:storyboardId
 * Get rendering progress for a storyboard
 */
router.get(
  '/progress/:storyboardId',
  asyncHandler(async (req: Request, res: Response) => {
    const { storyboardId } = req.params;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id: storyboardId },
      include: {
        scenes: {
          select: {
            id: true,
            sceneNumber: true,
            status: true,
            estimatedDuration: true,
            actualDuration: true,
          },
          orderBy: { sceneNumber: 'asc' },
        },
      },
    });

    if (!storyboard) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Storyboard not found',
      });
    }

    const totalScenes = storyboard.scenes.length;
    const completedScenes = storyboard.scenes.filter(
      (s) => s.status === 'completed'
    ).length;
    const processingScenes = storyboard.scenes.filter(
      (s) => s.status === 'processing'
    ).length;
    const pendingScenes = storyboard.scenes.filter(
      (s) => s.status === 'pending'
    ).length;
    const failedScenes = storyboard.scenes.filter(
      (s) => s.status === 'failed'
    ).length;

    const progress = Math.round((completedScenes / totalScenes) * 100);

    // Estimate remaining time (rough estimate: 40 seconds per scene)
    const estimatedTimeRemaining =
      (pendingScenes + processingScenes) * 40;

    return res.json({
      storyboardId,
      status: storyboard.status,
      progress,
      totalScenes,
      completedScenes,
      processingScenes,
      pendingScenes,
      failedScenes,
      estimatedTimeRemaining,
      finalVideoUrl: storyboard.finalVideoUrl,
      scenes: storyboard.scenes,
    });
  })
);

/**
 * POST /api/render/retry/:sceneId
 * Retry rendering a failed scene
 */
router.post(
  '/retry/:sceneId',
  asyncHandler(async (req: Request, res: Response) => {
    const { sceneId } = req.params;
    const { quality = 'medium' } = req.body;

    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
    });

    if (!scene) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Scene not found',
      });
    }

    console.log(`🔄 Retrying scene: ${sceneId}`);

    try {
      await prisma.scene.update({
        where: { id: sceneId },
        data: { status: 'processing' },
      });

      // Import services
      const { generateAudio } = await import('../services/elevenlabs');
      const { triggerRenderer } = await import('../services/renderer');

      // Regenerate audio
      const audioData = await generateAudio(scene.narration, scene.id);

      await prisma.scene.update({
        where: { id: sceneId },
        data: {
          audioUrl: audioData.audioUrl,
          actualDuration: audioData.duration,
        },
      });

      // Render video
      const manimOperations = JSON.parse(scene.manimCode);
      const renderResult = await triggerRenderer(
        scene.id,
        manimOperations,
        audioData.duration,
        quality
      );

      const completedScene = await prisma.scene.update({
        where: { id: sceneId },
        data: {
          videoUrl: renderResult.videoUrl,
          status: 'completed',
        },
      });

      return res.json({
        ...completedScene,
        manimCode: JSON.parse(completedScene.manimCode),
      });
    } catch (error) {
      await prisma.scene.update({
        where: { id: sceneId },
        data: { status: 'failed' },
      });

      throw error;
    }
  })
);

export default router;