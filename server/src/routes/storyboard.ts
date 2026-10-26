import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { generateStoryboard } from '../services/gemini';
import { generateAudio } from '../services/elevenlabs';
import { triggerRenderer, assembleVideo, deleteStorageObjects } from '../services/renderer';
import { processStoryboardScenes } from '../services/orchestrator';
import { assembleStoryboard } from '../services/assembly';
import { validateRequest } from '../middleware/validation';
import { asyncHandler } from '../middleware/asyncHandler';
import { findDemoSource } from '../lib/demo';
import { withVideoCost } from '../services/llmUsage';
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

  try {
    await processStoryboardScenes(storyboardId);
  } catch (orchestrationError) {
    const msg = orchestrationError instanceof Error ? orchestrationError.message : 'Unknown error';
    console.error('❌ Orchestration crashed:', msg);
    await prisma.storyboard.update({
      where: { id: storyboardId },
      data: { status: 'failed', errorMessage: msg.slice(0, 2000) },
    });
    return;
  }

  // After orchestration, assemble the final video from whatever completed.
  // assembleStoryboard handles the all-scenes-failed case itself, and now also
  // owns the terminal status — the orchestrator deliberately leaves the
  // storyboard 'processing' so the UI can show the stitching stage.
  //
  // Guarded because of that ownership: if this threw, the storyboard would sit
  // in 'processing' forever and the dashboard would poll it indefinitely.
  try {
    await assembleStoryboard(storyboardId);
  } catch (assemblyError) {
    const msg = assemblyError instanceof Error ? assemblyError.message : 'Unknown error';
    console.error('❌ Assembly crashed:', msg);
    await prisma.storyboard.update({
      where: { id: storyboardId },
      data: { status: 'failed', errorMessage: `Assembly failed: ${msg}`.slice(0, 2000) },
    }).catch(() => { /* row may be gone */ });
  }
}

// ==========================================
// HELPER: Plan a storyboard in the background
// ==========================================
//
// Planning (brief + scene plan) is a minute or more of Gemini calls, longer
// when the free-tier pacer or a 5xx retry kicks in. POST / used to hold the
// request open for all of it, so the user sat on a spinning button with no
// storyboard page to look at. Now the row is created first with
// status='planning', the client navigates to it and polls, and this fills in
// the scenes (→ 'draft') or records why it couldn't (→ 'failed').

/** Ids being planned by THIS process — the stale-planning sweep skips them. */
const planningInFlight = new Set<string>();

/** Title shown while planning; replaced by the model's title unless renamed. */
function placeholderTitle(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
}

async function planStoryboard(
  storyboardId: string,
  prompt: string,
  autoGenerate: boolean
): Promise<void> {
  if (planningInFlight.has(storyboardId)) return;
  planningInFlight.add(storyboardId);
  console.log(`📝 Planning storyboard ${storyboardId}: "${prompt.substring(0, 50)}..."`);

  try {
    const planned = await withVideoCost(storyboardId, async () => {
      const storyboardData = await generateStoryboard(prompt);

      return prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the user may have deleted the
        // storyboard, or renamed it, while the model was thinking.
        const current = await tx.storyboard.findUnique({
          where: { id: storyboardId },
          select: { status: true, title: true },
        });
        if (!current || current.status !== 'planning') return false;

        const scenes = storyboardData.scenes.map((scene, index) => ({
          storyboardId,
          sceneNumber: index + 1,
          narration: scene.narration,
          visualDescription: scene.visualDescription,
          manimCode: JSON.stringify(scene.manimOperations),
          estimatedDuration: scene.estimatedDuration,
          status: 'pending',
        }));
        await tx.scene.createMany({ data: scenes });

        await tx.storyboard.update({
          where: { id: storyboardId },
          data: {
            title:
              current.title === placeholderTitle(prompt)
                ? storyboardData.title
                : current.title,
            description: storyboardData.description,
            status: 'draft',
            errorMessage: null,
            // Persist the brief. It decides the worked example every scene is
            // built around, and was previously thrown away after planning — so a
            // scene retried an hour later had to infer that example from its own
            // description and whatever could be scraped out of sibling scenes.
            brief: storyboardData.brief ? JSON.stringify(storyboardData.brief) : null,
            totalDuration: scenes.reduce((sum, s) => sum + s.estimatedDuration, 0),
          },
        });
        return true;
      });
    });

    if (!planned) {
      console.log(`🗑️  Storyboard ${storyboardId} was deleted or reset during planning — discarding plan.`);
      return;
    }
    console.log(`✅ Storyboard ${storyboardId} planned.`);

    // Auto-process scenes only when the client opts in (legacy default).
    // For the AnimG-style "Review Spec → Iterate" flow, the client sends
    // autoGenerate: false and triggers rendering later via POST /:id/render.
    if (autoGenerate) {
      console.log('🚀 Auto-processing all scenes...');
      await processAllScenes(storyboardId);
    } else {
      console.log('📝 Storyboard created in draft mode (no auto-render).');
      // Narration is NOT started here.
      //
      // It used to be, to hide TTS latency behind the user reading the
      // storyboard. But narration is now uploaded to the bucket, and objects
      // are only ever removed when a storyboard is deleted or pruned after a
      // complete render — so every abandoned draft left its scene audio in
      // storage permanently, with no cleanup path. A user who creates five
      // drafts and renders one leaks four storyboards' worth.
      //
      // /api/scene/:id/generate-code calls ensureSceneAudio before deriving its
      // timing budget, so the measured-audio guarantee is unaffected; the only
      // loss is the latency hiding, roughly 2s per scene added to a code-gen
      // loop that already spends 5-10s per scene on Gemini.
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Planning failed for storyboard ${storyboardId}:`, msg);
    // updateMany so a storyboard deleted mid-plan is a no-op, not a throw.
    // The raw message is stored for admins; user routes sanitize it.
    await prisma.storyboard
      .updateMany({
        where: { id: storyboardId, status: 'planning' },
        data: { status: 'failed', errorMessage: msg.slice(0, 2000) },
      })
      .catch((e) => console.error('❌ Could not record planning failure:', e));
  } finally {
    planningInFlight.delete(storyboardId);
  }
}

// A row left in 'planning' with nothing working on it — the server restarted
// mid-plan — would otherwise be polled by the dashboard forever. Fail it so the
// user gets a retry button. Rows this process is planning are skipped; the age
// floor covers an old instance still finishing during a zero-downtime deploy.
const STALE_PLANNING_MS = 2 * 60 * 1000;

async function failInterruptedPlanning(): Promise<void> {
  try {
    const { count } = await prisma.storyboard.updateMany({
      where: {
        status: 'planning',
        id: { notIn: [...planningInFlight] },
        updatedAt: { lt: new Date(Date.now() - STALE_PLANNING_MS) },
      },
      data: {
        status: 'failed',
        errorMessage: 'Storyboard planning was interrupted by a server restart.',
      },
    });
    if (count > 0) console.log(`🧹 Marked ${count} interrupted planning storyboard(s) as failed.`);
  } catch (err) {
    console.error('❌ Stale-planning sweep failed:', (err as Error).message);
  }
}

setInterval(failInterruptedPlanning, 60 * 1000).unref();

// ==========================================
// VALIDATION SCHEMAS (Latest Zod)
// ==========================================

const createStoryboardSchema = z.object({
  prompt: z.string()
    .min(10, 'Prompt must be at least 10 characters')
    .max(2000, 'Prompt must be less than 2000 characters'),
  // userId is no longer accepted from the request body — it's pulled from
  // the verified Supabase JWT via requireAuth middleware (req.user.id).
  autoGenerate: z.boolean().optional().default(true),
  // Hidden hint from the dashboard suggestion UI: when set AND matches a
  // registered demo source, the server clones that pre-rendered storyboard
  // into the user's account instead of calling the LLM. Server-side
  // exact-prompt matching is a second detection path.
  demoStoryboardId: z.string().optional(),
});

const updateStoryboardSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'processing', 'completed', 'failed']).optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(500).default(10),
  offset: z.coerce.number().min(0).default(0),
  status: z.enum(['planning', 'draft', 'processing', 'completed', 'failed']).optional(),
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
 *
 * Self-cleaning: every call first deletes this user's previous test
 * storyboards. The render pipeline is DB-driven (it looks scenes up by id),
 * so a test run has to write rows — but it never accumulates them. At most
 * one test storyboard exists at a time and it disappears on the next run,
 * which keeps diagnostic runs out of the permanent history.
 */
const TEST_STORYBOARD_TITLE = 'Test: Cognito Stream Demo';
const TEST_STORYBOARD_PROMPT =
  'TEST: Cognito Stream demo with shapes, Pythagorean theorem, and linear graph';

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

    const userId = req.user!.id;

    // Drop this user's earlier test runs first. Matched on title AND prompt
    // so a real storyboard that happens to share a name is never touched,
    // and scoped to userId so one admin's cleanup can't reach another's
    // rows. Scenes go with them via ON DELETE CASCADE.
    const purged = await prisma.storyboard.deleteMany({
      where: {
        userId,
        title: TEST_STORYBOARD_TITLE,
        prompt: TEST_STORYBOARD_PROMPT,
      },
    });
    if (purged.count > 0) {
      console.log(`🧹 Purged ${purged.count} previous test storyboard(s)`);
    }

    const storyboard = await prisma.$transaction(async (tx) => {
      const newStoryboard = await tx.storyboard.create({
        data: {
          userId,
          title: TEST_STORYBOARD_TITLE,
          description: 'Hardcoded test storyboard — no AI credits used',
          prompt: TEST_STORYBOARD_PROMPT,
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
    const { prompt, demoStoryboardId } = req.body;
    const userId = req.user!.id; // requireAuth middleware guarantees this

    // ---------------------------------------------------------------
    // Demo / suggestion clone path.
    // If the prompt matches a registered demo (or the client passes a
    // valid demoStoryboardId), skip the LLM entirely and clone the
    // source storyboard's scenes (narration + visualDescription only,
    // status='pending') into a new row owned by this user. Manim code
    // and final video URL are revealed lazily when the user clicks
    // Generate Code / Render Final Video. From the user's perspective
    // this is indistinguishable from a real generation.
    // ---------------------------------------------------------------
    const demoSourceId = findDemoSource(prompt, demoStoryboardId);
    if (demoSourceId) {
      console.log(`✨ Demo clone — source=${demoSourceId}, user=${userId}`);
      const source = await prisma.storyboard.findUnique({
        where: { id: demoSourceId },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
      });
      if (!source) {
        return res.status(500).json({
          error: 'Demo Source Missing',
          message: `Demo storyboard ${demoSourceId} not found`,
        });
      }
      const cloned = await prisma.storyboard.create({
        data: {
          userId,
          title: source.title,
          description: source.description,
          prompt,
          status: 'draft',
          totalDuration: source.totalDuration,
          demoSourceId: source.id,
          scenes: {
            create: source.scenes.map((sc) => ({
              sceneNumber: sc.sceneNumber,
              narration: sc.narration,
              visualDescription: sc.visualDescription,
              manimCode: '', // hidden until the user clicks "Generate Code"
              estimatedDuration: sc.estimatedDuration,
              status: 'pending',
            })),
          },
        },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
      });
      const responseData = {
        ...cloned,
        scenes: cloned.scenes.map((scene) => ({
          ...scene,
          manimCode: safeParseManimCode(scene.manimCode || '{}'),
        })),
      };
      return res.status(201).json(responseData);
    }

    // Create the row first and plan in the background — see planStoryboard.
    // The client navigates straight to the storyboard page and polls it.
    const { autoGenerate } = req.body;
    const storyboard = await prisma.storyboard.create({
      data: {
        userId,
        title: placeholderTitle(prompt),
        description: '',
        prompt,
        status: 'planning',
      },
      include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
    });
    console.log(`📝 Storyboard ${storyboard.id} created for user ${userId} — planning in background.`);

    void planStoryboard(storyboard.id, prompt, autoGenerate !== false);

    return res.status(202).json(storyboard);
  })
);

/**
 * POST /api/storyboard/:id/plan
 * Retry planning for a storyboard whose planning failed (a Gemini outage, a
 * server restart). Reuses the same row, so the user's link and history entry
 * stay put. Returns immediately with status='planning'; the client polls.
 */
router.post(
  '/:id/plan',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const existing = await prisma.storyboard.findFirst({
      where: { id, userId },
      include: { _count: { select: { scenes: true } } },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'Storyboard not found' });
    }
    if (existing.status !== 'failed' || existing._count.scenes > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Only a storyboard whose planning failed can be re-planned.',
      });
    }

    const storyboard = await prisma.storyboard.update({
      where: { id },
      data: { status: 'planning', errorMessage: null },
      include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
    });

    // Re-planning a draft never auto-renders — the review flow is the only
    // client that reaches this route.
    void planStoryboard(id, existing.prompt, false);

    return res.status(202).json(storyboard);
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
    const userId = req.user!.id;

    const storyboard = await prisma.storyboard.findFirst({
      where: { id, userId },
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

    // ---------------------------------------------------------------
    // Demo clone: copy the source storyboard's finalVideoUrl + each
    // scene's videoUrl / audioUrl / thumbnailUrl / actualDuration in
    // place. No renderer call. Same response shape — invisible.
    // ---------------------------------------------------------------
    const demoSourceId: string | null = storyboard.demoSourceId ?? null;
    if (demoSourceId) {
      const source = await prisma.storyboard.findUnique({
        where: { id: demoSourceId },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
      });
      if (!source) {
        return res.status(500).json({
          error: 'Demo Source Missing',
          message: 'Demo source storyboard not found',
        });
      }
      console.log(`✨ [Demo] Copying source video URLs for storyboard ${id}`);
      // Mirror per-scene URLs.
      await Promise.all(
        storyboard.scenes.map(async (s) => {
          const src = source.scenes.find((x) => x.sceneNumber === s.sceneNumber);
          if (!src) return;
          await prisma.scene.update({
            where: { id: s.id },
            data: {
              videoUrl: src.videoUrl,
              audioUrl: src.audioUrl,
              thumbnailUrl: src.thumbnailUrl,
              actualDuration: src.actualDuration,
              status: 'completed',
            },
          });
        })
      );
      const completed = await prisma.storyboard.update({
        where: { id },
        data: {
          status: 'completed',
          finalVideoUrl: source.finalVideoUrl,
        },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
      });
      return res.json({
        ...completed,
        scenes: completed.scenes.map((s) => ({
          ...s,
          manimCode: safeParseManimCode(s.manimCode || '{}'),
        })),
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
    const userId = req.user!.id;

    const where = query.status
      ? { status: query.status, userId }
      : { userId };

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
              thumbnailUrl: true,
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
    const userId = req.user!.id;

    const storyboard = await prisma.storyboard.findFirst({
      where: { id, userId },
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
    const userId = req.user!.id;

    // Verify ownership before updating.
    const existing = await prisma.storyboard.findFirst({ where: { id, userId } });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'Storyboard not found' });
    }

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
    const userId = req.user!.id;

    const existing = await prisma.storyboard.findFirst({
      where: { id, userId },
      include: {
        scenes: { select: { videoUrl: true, audioUrl: true, thumbnailUrl: true } },
      },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'Storyboard not found' });
    }

    // Collect the storage objects BEFORE the rows cascade away — afterwards
    // nothing records where they live and they are orphaned permanently.
    const objectUrls = [
      existing.finalVideoUrl,
      ...existing.scenes.flatMap((sc) => [sc.videoUrl, sc.audioUrl, sc.thumbnailUrl]),
    ];

    await prisma.storyboard.delete({ where: { id } });

    // After the delete, and not awaited: the user's storyboard is already gone
    // as far as they are concerned, and a renderer outage must not make the
    // delete appear to fail.
    void deleteStorageObjects(objectUrls);

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
    const userId = req.user!.id;

    const storyboard = await prisma.storyboard.findFirst({
      where: { id, userId },
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
