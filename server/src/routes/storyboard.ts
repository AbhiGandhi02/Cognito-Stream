import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { generateStoryboard } from '../services/gemini';
import { generateAudio } from '../services/elevenlabs';
import { triggerRenderer, assembleVideo } from '../services/renderer';
import { processStoryboardScenes } from '../services/orchestrator';
import { validateRequest } from '../middleware/validation';
import { asyncHandler } from '../middleware/asyncHandler';
import { z } from 'zod';

const router = Router();

// ==========================================
// HELPER: Process all scenes automatically
// ==========================================

/**
 * Process all scenes using the orchestrator pipeline.
 * Generates Manim code via AI, renders, auto-corrects errors, and generates TTS.
 */
async function processAllScenes(storyboardId: string): Promise<void> {
  console.log(`🎬 Starting orchestrated pipeline for storyboard: ${storyboardId}`);

  const result = await processStoryboardScenes(storyboardId);

  // After orchestration, assemble final video from completed scenes
  if (result.completedScenes > 0) {
    try {
      const completedScenes = await prisma.scene.findMany({
        where: { storyboardId, status: 'completed', videoUrl: { not: null } },
        orderBy: { sceneNumber: 'asc' },
      });

      if (completedScenes.length > 0) {
        console.log(`🎞️ Assembling final video from ${completedScenes.length} scenes...`);

        const assemblyResult = await assembleVideo(
          storyboardId,
          completedScenes.map(s => ({
            videoUrl: s.videoUrl!,
            audioUrl: s.audioUrl || '',
            duration: s.actualDuration || s.estimatedDuration,
            sceneNumber: s.sceneNumber,
          })),
          'medium'
        );

        await prisma.storyboard.update({
          where: { id: storyboardId },
          data: {
            finalVideoUrl: assemblyResult.videoUrl,
            totalDuration: assemblyResult.totalDuration,
            status: 'completed',
          },
        });

        console.log(`🎉 Pipeline complete! Final video: ${assemblyResult.videoUrl}`);
      }
    } catch (assemblyError) {
      console.error('❌ Final video assembly failed:', assemblyError);
    }
  } else {
    console.log('⚠️ No scenes rendered successfully');
  }
}

// ==========================================
// VALIDATION SCHEMAS (Latest Zod)
// ==========================================

const createStoryboardSchema = z.object({
  prompt: z.string()
    .min(10, 'Prompt must be at least 10 characters')
    .max(2000, 'Prompt must be less than 2000 characters'),
  userId: z.string().optional(),
  autoGenerate: z.boolean().optional().default(true),
});

const updateStoryboardSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'processing', 'completed', 'failed']).optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10),
  offset: z.coerce.number().min(0).default(0),
  status: z.enum(['draft', 'processing', 'completed', 'failed']).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ==========================================
// ROUTES
// ==========================================

/**
 * POST /api/storyboard/test
 * Create a mock storyboard without calling Gemini API (for testing)
 */
router.post(
  '/test',
  asyncHandler(async (req: Request, res: Response) => {
    console.log('🧪 Creating test storyboard (no AI)...');

    // Mock storyboard data
    const mockStoryboard = {
      title: 'Test Video: Bubble Sort',
      description: 'A simple test animation to verify the rendering pipeline',
      scenes: [
        {
          narration: 'This is a test scene to verify the video rendering works correctly.',
          visualDescription: 'A simple animation with text and shapes',
          manimOperations: [
            'Text("Cognito Stream Test", color=BLUE).scale(1.5)',
            'Circle(radius=1, color=GREEN).shift(DOWN * 2)',
          ],
          estimatedDuration: 5,
        },
      ],
    };

    const storyboard = await prisma.$transaction(async (tx) => {
      const newStoryboard = await tx.storyboard.create({
        data: {
          title: mockStoryboard.title,
          description: mockStoryboard.description,
          prompt: 'TEST: bubble sort explanation',
          status: 'draft',
          scenes: {
            create: mockStoryboard.scenes.map((scene, index) => ({
              sceneNumber: index + 1,
              narration: scene.narration,
              visualDescription: scene.visualDescription,
              manimCode: JSON.stringify(scene.manimOperations),
              estimatedDuration: scene.estimatedDuration,
              status: 'pending',
            })),
          },
        },
        include: {
          scenes: { orderBy: { sceneNumber: 'asc' } },
        },
      });

      return newStoryboard;
    });

    // Start auto-processing
    console.log('🚀 Auto-processing test storyboard...');
    processAllScenes(storyboard.id).catch(err => {
      console.error('❌ Test auto-generation failed:', err.message);
    });

    res.status(201).json({
      ...storyboard,
      scenes: storyboard.scenes.map(scene => ({
        ...scene,
        manimCode: JSON.parse(scene.manimCode || '[]'),
      })),
    });
  })
);

/**
 * POST /api/storyboard
 */
router.post(
  '/',
  validateRequest(createStoryboardSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { prompt, userId } = req.body;

    console.log(`📝 Generating storyboard for prompt: "${prompt.substring(0, 50)}..."`);

    const storyboardData = await generateStoryboard(prompt);

    const storyboard = await prisma.$transaction(async (tx) => {
      const newStoryboard = await tx.storyboard.create({
        data: {
          title: storyboardData.title,
          description: storyboardData.description,
          prompt,
          status: 'draft',
          scenes: {
            create: storyboardData.scenes.map((scene, index) => ({
              sceneNumber: index + 1,
              narration: scene.narration,
              visualDescription: scene.visualDescription,
              manimCode: JSON.stringify(scene.manimOperations),
              estimatedDuration: scene.estimatedDuration,
              status: 'pending',
            })),
          },
        },
        include: {
          scenes: { orderBy: { sceneNumber: 'asc' } },
        },
      });

      const totalDuration = newStoryboard.scenes.reduce(
        (sum, scene) => sum + scene.estimatedDuration,
        0
      );

      return tx.storyboard.update({
        where: { id: newStoryboard.id },
        data: { totalDuration },
        include: {
          scenes: { orderBy: { sceneNumber: 'asc' } },
        },
      });
    });

    // Parse scenes for response
    const responseData = {
      ...storyboard,
      scenes: storyboard.scenes.map(scene => ({
        ...scene,
        manimCode: JSON.parse(scene.manimCode || '{}'),
      })),
    };

    // Always auto-process all scenes in background
    console.log('🚀 Auto-processing all scenes...');
    processAllScenes(storyboard.id).catch(err => {
      console.error('❌ Auto-generation failed:', err.message);
    });

    res.status(201).json(responseData);
  })
);

/**
 * GET /api/storyboard
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);

    const where = query.status ? { status: query.status } : {};

    const [storyboards, total] = await Promise.all([
      prisma.storyboard.findMany({
        where,
        include: {
          scenes: {
            orderBy: { sceneNumber: 'asc' },
            select: {
              id: true,
              sceneNumber: true,
              status: true,
              estimatedDuration: true,
              actualDuration: true,
            },
          },
        },
        orderBy: { [query.sortBy]: query.sortOrder },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.storyboard.count({ where }),
    ]);

    res.json({
      data: storyboards,
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + query.limit < total,
      },
    });
  })
);

/**
 * GET /api/storyboard/:id
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id },
      include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
    });

    if (!storyboard)
      return res.status(404).json({ error: 'Not Found', message: 'Storyboard not found' });

    return res.json({
      ...storyboard,
      scenes: storyboard.scenes.map(scene => ({
        ...scene,
        manimCode: JSON.parse(scene.manimCode || '{}'),
      })),
    });
  })
);

/**
 * PATCH /api/storyboard/:id
 */
router.patch(
  '/:id',
  validateRequest(updateStoryboardSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const storyboard = await prisma.storyboard.update({
      where: { id },
      data: req.body,
      include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
    });

    return res.json({
      ...storyboard,
      scenes: storyboard.scenes.map(scene => ({
        ...scene,
        manimCode: JSON.parse(scene.manimCode || '{}'),
      })),
    });
  })
);

/**
 * DELETE /api/storyboard/:id
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    await prisma.storyboard.delete({ where: { id } });

    return res.json({
      success: true,
      message: 'Storyboard deleted successfully',
    });
  })
);

/**
 * GET /api/storyboard/:id/stats
 */
router.get(
  '/:id/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id },
      include: { scenes: true },
    });

    if (!storyboard)
      return res.status(404).json({ error: 'Not Found', message: 'Storyboard not found' });

    const stats = {
      totalScenes: storyboard.scenes.length,
      completedScenes: storyboard.scenes.filter(s => s.status === 'completed').length,
      pendingScenes: storyboard.scenes.filter(s => s.status === 'pending').length,
      processingScenes: storyboard.scenes.filter(s => s.status === 'processing').length,
      failedScenes: storyboard.scenes.filter(s => s.status === 'failed').length,
      estimatedDuration: storyboard.totalDuration,
      actualDuration: storyboard.scenes.reduce(
        (sum, scene) => sum + (scene.actualDuration || 0),
        0
      ),
      progress: Math.round(
        (storyboard.scenes.filter(s => s.status === 'completed').length /
          storyboard.scenes.length) *
        100
      ),
    };

    return res.json(stats);
  })
);

export default router;
