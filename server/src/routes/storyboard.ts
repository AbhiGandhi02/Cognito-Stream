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

/** Safely parse manimCode — handles both JSON arrays and raw Python strings */
function safeParseManimCode(manimCode: string | null): any {
  if (!manimCode) return {};
  try {
    return JSON.parse(manimCode);
  } catch {
    return manimCode;
  }
}

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
 * Create a test storyboard with hardcoded Manim code — NO AI credits used.
 * Scenes have complete, renderable Manim Python scripts baked in.
 */
router.post(
  '/test',
  asyncHandler(async (req: Request, res: Response) => {
    console.log('🧪 Creating test storyboard with hardcoded Manim code (no AI)...');

    // ── Hardcoded Manim Python scripts ──────────────────────────────

    const scene1Code = `from manim import *
import numpy as np

class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#1a1a2e"

        # Title
        title = Text("Welcome to Cognito Stream", color=BLUE, font_size=48)
        subtitle = Text("AI-Powered Video Engine", color=WHITE, font_size=28)
        subtitle.next_to(title, DOWN, buff=0.5)

        self.play(Write(title), run_time=1.5)
        self.play(FadeIn(subtitle, shift=UP * 0.3), run_time=1)
        self.wait(1)

        # Animate shapes
        circle = Circle(radius=0.8, color=BLUE, fill_opacity=0.6).shift(LEFT * 3)
        square = Square(side_length=1.4, color=GREEN, fill_opacity=0.6)
        triangle = Triangle(color=YELLOW, fill_opacity=0.6).shift(RIGHT * 3)

        shapes = VGroup(circle, square, triangle)
        shapes.shift(DOWN * 1.5)

        self.play(
            FadeOut(title), FadeOut(subtitle),
            run_time=0.5
        )
        self.play(
            Create(circle), Create(square), Create(triangle),
            run_time=1.5
        )
        self.wait(1)

        # Transform all into a single star
        star = Star(n=5, outer_radius=1.5, color=GOLD, fill_opacity=0.8)
        self.play(
            ReplacementTransform(shapes, star),
            run_time=1.5
        )
        self.wait(1)
`;

    const scene2Code = `from manim import *
import numpy as np

class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#1a1a2e"

        # Pythagorean theorem
        title = Text("The Pythagorean Theorem", color=YELLOW, font_size=40)
        title.to_edge(UP, buff=0.5)
        self.play(Write(title), run_time=1)

        # Show the formula
        formula = MathTex(r"a^2 + b^2 = c^2", color=WHITE, font_size=60)
        self.play(Write(formula), run_time=1.5)
        self.wait(0.5)

        # Move formula up and show triangle
        self.play(formula.animate.shift(UP * 1.5).scale(0.7), run_time=0.8)

        # Draw a right triangle
        A = np.array([-2, -1.5, 0])
        B = np.array([1, -1.5, 0])
        C = np.array([-2, 1, 0])

        side_a = Line(A, B, color=RED, stroke_width=4)
        side_b = Line(A, C, color=GREEN, stroke_width=4)
        side_c = Line(B, C, color=BLUE, stroke_width=4)

        label_a = MathTex("a", color=RED, font_size=36).next_to(side_a, DOWN, buff=0.2)
        label_b = MathTex("b", color=GREEN, font_size=36).next_to(side_b, LEFT, buff=0.2)
        label_c = MathTex("c", color=BLUE, font_size=36).next_to(side_c, UR, buff=0.2)

        right_angle = Square(side_length=0.3, color=WHITE, stroke_width=2)
        right_angle.move_to(A + np.array([0.15, 0.15, 0]))

        self.play(
            Create(side_a), Create(side_b), Create(side_c),
            Write(label_a), Write(label_b), Write(label_c),
            Create(right_angle),
            run_time=2
        )
        self.wait(2)
`;

    const scene3Code = `from manim import *
import numpy as np

class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = "#1a1a2e"

        # Graph example
        title = Text("Linear Function", color=TEAL, font_size=40)
        title.to_edge(UP, buff=0.4)
        self.play(Write(title), run_time=0.8)

        # Create axes
        axes = Axes(
            x_range=[-3, 3, 1],
            y_range=[-2, 8, 1],
            x_length=7,
            y_length=5,
            axis_config={"include_numbers": True, "font_size": 20, "color": GRAY},
        )
        axes.shift(DOWN * 0.3)

        self.play(Create(axes), run_time=1.5)

        # Plot y = 2x + 1
        graph = axes.plot(lambda x: 2 * x + 1, color=YELLOW, x_range=[-2.5, 2.8])
        graph_label = MathTex("y = 2x + 1", color=YELLOW, font_size=30)
        graph_label.next_to(axes.c2p(2, 5), UR, buff=0.2)

        self.play(Create(graph), Write(graph_label), run_time=2)
        self.wait(0.5)

        # Highlight a point
        dot = Dot(axes.c2p(1, 3), color=RED, radius=0.1)
        dot_label = MathTex("(1, 3)", color=RED, font_size=28).next_to(dot, UR, buff=0.15)

        self.play(Create(dot), Write(dot_label), run_time=1)
        self.wait(2)
`;

    // ── Scene narration & metadata ──────────────────────────────────

    const testScenes = [
      {
        narration: 'Welcome to Cognito Stream, an AI-powered video engine that transforms your text prompts into narrated 2D animated videos. Let us show you how it works.',
        visualDescription: 'Title text appears, shapes animate in, then merge into a star.',
        manimCode: scene1Code,
        estimatedDuration: 7,
      },
      {
        narration: 'The Pythagorean theorem states that in a right triangle, the square of the hypotenuse equals the sum of the squares of the other two sides. This fundamental relationship is written as a squared plus b squared equals c squared.',
        visualDescription: 'Show the Pythagorean formula, then draw a labeled right triangle below it.',
        manimCode: scene2Code,
        estimatedDuration: 7,
      },
      {
        narration: 'Here we visualize the linear function y equals 2x plus 1. The graph is a straight line with a slope of 2, passing through the point 1 comma 3.',
        visualDescription: 'Draw coordinate axes, plot y=2x+1 as a yellow line, and highlight the point (1,3).',
        manimCode: scene3Code,
        estimatedDuration: 7,
      },
    ];

    // ── Create storyboard in DB ─────────────────────────────────────

    const storyboard = await prisma.$transaction(async (tx) => {
      const newStoryboard = await tx.storyboard.create({
        data: {
          title: 'Test: Cognito Stream Demo',
          description: 'Hardcoded test storyboard — no AI credits used',
          prompt: 'TEST: Cognito Stream demo with shapes, Pythagorean theorem, and linear graph',
          status: 'draft',
          scenes: {
            create: testScenes.map((scene, index) => ({
              sceneNumber: index + 1,
              narration: scene.narration,
              visualDescription: scene.visualDescription,
              manimCode: scene.manimCode, // Full Python script stored directly
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

    // ── Start auto-processing (orchestrator will use stored manimCode) ──
    console.log('🚀 Auto-processing test storyboard...');
    processAllScenes(storyboard.id).catch(err => {
      console.error('❌ Test auto-generation failed:', err.message);
    });

    res.status(201).json({
      ...storyboard,
      scenes: storyboard.scenes.map(scene => ({
        ...scene,
        manimCode: scene.manimCode,
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
        manimCode: safeParseManimCode(scene.manimCode || '{}'),
      })),
    };

    // Auto-process scenes only when the client opts in (legacy default).
    // For the AnimG-style "Review Spec → Iterate" flow, the client should send
    // autoGenerate: false and trigger rendering later via POST /api/storyboard/:id/render.
    const { autoGenerate } = req.body;
    if (autoGenerate !== false) {
      console.log('🚀 Auto-processing all scenes...');
      processAllScenes(storyboard.id).catch(err => {
        console.error('❌ Auto-generation failed:', err.message);
      });
    } else {
      console.log('📝 Storyboard created in draft mode (no auto-render).');
    }

    res.status(201).json(responseData);
  })
);

/**
 * POST /api/storyboard/:id/render
 * Trigger the full pipeline (code-gen for any missing scenes, Manim render,
 * TTS, final assembly) for an existing storyboard. Used by the AnimG-style
 * "Review → Render" flow where scenes are created in draft mode first.
 *
 * Runs asynchronously: returns the storyboard with status='processing' and
 * the frontend polls until status flips to 'completed' / 'failed'.
 */
router.post(
  '/:id/render',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id },
      include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
    });

    if (!storyboard) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Storyboard not found',
      });
    }

    if (!storyboard.scenes || storyboard.scenes.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Storyboard has no scenes to render',
      });
    }

    // Mark as processing immediately so the polling UI sees the state change.
    await prisma.storyboard.update({
      where: { id },
      data: { status: 'processing' },
    });

    // Kick off the full pipeline in background — same path as autoGenerate=true.
    // The orchestrator skips re-generation for scenes that already have code.
    console.log(`🚀 Starting render pipeline for storyboard ${id}`);
    processAllScenes(id).catch((err) => {
      console.error('❌ Render pipeline failed:', err.message);
    });

    // Return updated storyboard right away. Frontend polls for completion.
    const updated = await prisma.storyboard.findUnique({
      where: { id },
      include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
    });

    return res.json({
      ...updated,
      scenes: updated!.scenes.map((s) => ({
        ...s,
        manimCode: safeParseManimCode(s.manimCode || '{}'),
      })),
    });
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
        manimCode: safeParseManimCode(scene.manimCode || '{}'),
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
        manimCode: safeParseManimCode(scene.manimCode || '{}'),
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
