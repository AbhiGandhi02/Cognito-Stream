/**
 * Orchestrator service — coordinates the end-to-end scene processing pipeline.
 *
 * A storyboard runs in three phases, because the three stages have very
 * different cost profiles and very different ordering requirements:
 *
 *   Phase 1 — NARRATE (parallel)
 *     Piper TTS for every scene. ~2s each, no cross-scene dependency, and the
 *     measured audio length becomes the timing budget the animation is built
 *     to fit.
 *
 *   Phase 2 — WRITE CODE (sequential)
 *     Gemini writes each scene's Manim script in scene order, each one seeing
 *     what the scenes before it actually drew. ~3-5s each. This MUST be
 *     sequential: continuity is the whole point, and a scene cannot reuse an
 *     example array that has not been chosen yet.
 *
 *   Phase 3 — RENDER (parallel)
 *     Manim render plus the correction loop. ~60s each and by far the
 *     dominant cost, so this is where concurrency actually buys something.
 *
 * The previous design ran all three stages together in one parallel pool,
 * which meant every scene started before any had finished and so every scene
 * saw an EMPTY continuity context. For a storyboard of six scenes or fewer —
 * i.e. almost all of them — cross-scene consistency never happened at all.
 * Moving code generation into its own sequential phase costs ~20s on a
 * six-scene video and leaves the expensive stage fully parallel.
 */

import { prisma } from '../lib/prisma';
import { generateManimSceneCode, correctManimCode, normalizeManimCode } from './gemini';
import { triggerRendererWithCode } from './renderer';
import { generateAudio } from './elevenlabs';
import { withUsageRun } from './llmUsage';
import { resolveSceneDuration, countWords } from '../lib/narrationTiming';
import { buildSceneContext, type SceneContextEntry } from './sceneContext';

// ==========================================
// CONSTANTS
// ==========================================

const MAX_CORRECTION_ATTEMPTS = 3;
// Scenes rendered simultaneously in phase 3. Override via SCENE_CONCURRENCY.
//
// Set to match the renderer's CPU count, NOT higher. Manim rendering is
// CPU-bound: on the current single-CPU renderer plan, six concurrent renders
// do not finish six times faster — they timeshare one core and add scheduling
// overhead, while six Manim processes compete for 2GB of RAM. The old default
// of 6 bought no real parallelism there and risked memory pressure.
//
// Raise this only alongside renderer CPUs. Code generation is unaffected —
// phase 2 is deliberately sequential so each scene sees the ones before it.
const PARALLEL_CONCURRENCY = Number(process.env.SCENE_CONCURRENCY) || 2;

// ==========================================
// TYPES
// ==========================================

export interface SceneProcessingResult {
    sceneId: string;
    sceneNumber: number;
    status: 'completed' | 'failed';
    videoUrl?: string;
    audioUrl?: string;
    duration?: number;
    correctionAttempts: number;
    error?: string;
}

export interface OrchestrationResult {
    storyboardId: string;
    status: 'completed' | 'partially_completed' | 'failed';
    totalScenes: number;
    completedScenes: number;
    failedScenes: number;
    results: SceneProcessingResult[];
}

/** The scene fields every phase needs. */
export interface SceneInput {
    id: string;
    sceneNumber: number;
    narration: string;
    visualDescription: string;
    estimatedDuration: number;
    manimCode: string;
}

interface NarrationResult {
    audioUrl: string;
    duration: number;
}

/** Carries a scene between phases. */
interface ScenePrep {
    scene: SceneInput;
    audio: NarrationResult;
    targetDuration: number;
    manimCode: string | null;
    /** Set when phase 1 or 2 failed; phase 3 skips this scene. */
    error: string | null;
}

// ==========================================
// CONCURRENCY HELPER
// ==========================================

/**
 * Rolling worker pool — keeps `limit` tasks in flight, starting the next as
 * soon as one finishes. Better than batching: the slowest task in batch N no
 * longer blocks batch N+1.
 */
async function runPool<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>
): Promise<void> {
    let cursor = 0;
    const width = Math.max(1, Math.min(limit, items.length));
    async function worker(): Promise<void> {
        while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            await fn(items[index]);
        }
    }
    await Promise.all(Array.from({ length: width }, () => worker()));
}

// ==========================================
// PHASE 1 — NARRATE
// ==========================================

/**
 * Generate the voiceover and derive this scene's timing budget from it.
 *
 * Runs before code generation on purpose: the voiceover's real length is the
 * only honest duration target. Every scene used to be told "you have ~5
 * seconds" regardless of its script, so a 25-second narration got a 7-second
 * animation followed by 18 seconds of frozen frame.
 *
 * Never throws. generateAudio already degrades to a character-count estimate
 * when the renderer is unreachable; the catch here covers its input guards
 * (empty or oversized narration).
 */
async function narrateScene(
    scene: SceneInput,
    sceneLabel: string
): Promise<{ audio: NarrationResult; targetDuration: number }> {
    await prisma.scene.update({
        where: { id: scene.id },
        data: { status: 'processing' },
    });

    let audio: NarrationResult = { audioUrl: '', duration: 0 };
    try {
        audio = await generateAudio(scene.narration, scene.id);
    } catch (audioError) {
        const msg = String((audioError as Error)?.message ?? audioError).slice(0, 200);
        console.warn(`⚠️ [${sceneLabel}] TTS unavailable (${msg}) — using estimated duration`);
    }

    const targetDuration = resolveSceneDuration(scene.narration, audio.duration);
    console.log(
        `⏱️ [${sceneLabel}] Timing budget: ${targetDuration}s ` +
        `(${audio.duration > 0 ? `measured audio ${audio.duration.toFixed(1)}s` : 'estimated from word count'})`
    );

    // Persist immediately. A scene whose render later fails still has usable
    // narration, which is what a manual retry needs.
    if (audio.audioUrl) {
        await prisma.scene.update({
            where: { id: scene.id },
            data: { audioUrl: audio.audioUrl },
        });
    }

    return { audio, targetDuration };
}

// ==========================================
// PHASE 2 — WRITE CODE
// ==========================================

/**
 * Produce the scene's Manim script, reusing pre-stored code when present
 * (demo clones and the test storyboard ship with hand-written scripts).
 * Persists before returning so a later render failure cannot lose it.
 */
async function writeSceneCode(
    scene: SceneInput,
    sceneLabel: string,
    params: {
        overallTopic: string;
        totalScenes: number;
        targetDuration: number;
        previousSceneContext: string;
    }
): Promise<string> {
    // A complete script is already stored — skip the AI call entirely.
    if (scene.manimCode && scene.manimCode.includes('class GeneratedScene')) {
        console.log(`♻️ [${sceneLabel}] Using pre-stored Manim code (no AI call)`);
        // Auto-fix transforms run on cached code too: older storyboards may
        // have buggy code persisted before the transforms existed. Idempotent,
        // so a clean script passes through unchanged.
        return normalizeManimCode(scene.manimCode);
    }

    console.log(`🎨 [${sceneLabel}] Generating Manim code via AI...`);

    // Older rows stored a JSON array of operation strings here; the first
    // entry made a usable title. Not JSON on the current path, which is fine.
    let sceneTitle = `Scene ${scene.sceneNumber}`;
    try {
        const parsed = JSON.parse(scene.manimCode);
        if (Array.isArray(parsed) && parsed.length > 0) {
            sceneTitle = String(parsed[0]).substring(0, 50);
        }
    } catch {
        // manimCode may not be JSON, that's fine
    }

    const manimCode = await generateManimSceneCode({
        sceneTitle,
        narration: scene.narration,
        visualDescription: scene.visualDescription,
        duration: params.targetDuration,
        narrationWordCount: countWords(scene.narration),
        sceneNumber: scene.sceneNumber,
        totalScenes: params.totalScenes,
        overallTopic: params.overallTopic,
        previousSceneContext: params.previousSceneContext || undefined,
    });

    await prisma.scene.update({
        where: { id: scene.id },
        data: { manimCode },
    });

    return manimCode;
}

// ==========================================
// PHASE 3 — RENDER
// ==========================================

/**
 * Render the scene, repairing the code against the real crash output when it
 * fails, then write the finished scene to the DB.
 */
async function renderScene(
    prep: ScenePrep,
    sceneLabel: string
): Promise<SceneProcessingResult> {
    const { scene, audio, targetDuration } = prep;
    let manimCode = prep.manimCode as string;
    let correctionAttempts = 0;

    try {
        let renderResult = await triggerRendererWithCode(scene.id, manimCode);

        while (!renderResult.success && correctionAttempts < MAX_CORRECTION_ATTEMPTS) {
            correctionAttempts++;
            console.log(`🔧 [${sceneLabel}] Render failed, correcting (attempt ${correctionAttempts}/${MAX_CORRECTION_ATTEMPTS})...`);

            try {
                manimCode = await correctManimCode({
                    failedCode: manimCode,
                    errorStderr: renderResult.detailsStderr || '',
                    errorStdout: renderResult.detailsStdout || '',
                    errorType: renderResult.errorType,
                    parsedError: renderResult.parsedError,
                    sceneDescription: `${scene.visualDescription}\nNarration: ${scene.narration}`,
                    attemptNumber: correctionAttempts,
                });

                // Persist the corrected code so it's recoverable even if the
                // upcoming render attempt fails.
                await prisma.scene.update({
                    where: { id: scene.id },
                    data: { manimCode },
                });

                renderResult = await triggerRendererWithCode(scene.id, manimCode);
            } catch (correctionError) {
                // Log just the message — the cascade already sanitizes provider
                // errors into one-liners, but a stray axios object could still
                // dump its entire request payload if printed directly.
                const msg = String((correctionError as Error)?.message ?? correctionError).slice(0, 300);
                console.error(`❌ [${sceneLabel}] Code correction failed: ${msg}`);
                // Continue loop — next attempt may succeed
            }
        }

        if (!renderResult.success) {
            // Surface the actual stderr/stdout from the renderer so the UI can
            // show the real cause (e.g. TypeError about an invalid kwarg)
            // instead of the generic "Manim rendering failed".
            const stderr = (renderResult.detailsStderr || '').trim();
            const stdout = (renderResult.detailsStdout || '').trim();
            const summary = renderResult.error || 'Manim rendering failed';
            // Tail of stderr is almost always the most useful chunk (the
            // Python traceback ends there). Stdout is included only if stderr
            // is empty.
            const tail = stderr
                ? stderr.split('\n').slice(-25).join('\n')
                : stdout.split('\n').slice(-15).join('\n');
            throw new Error(
                `Rendering failed after ${correctionAttempts} correction attempts: ${summary}\n\n${tail}`.slice(0, 2000)
            );
        }

        // The stitched scene runs for max(video, audio): the renderer freezes
        // the last video frame when narration outlasts the animation, and pads
        // the audio with silence when the animation outlasts narration. Taking
        // the video length alone under-reported every scene with a longer
        // voiceover, which threw off the storyboard's total duration.
        const actualDuration = Math.max(
            renderResult.duration || 0,
            audio.duration || 0
        ) || targetDuration;

        await prisma.scene.update({
            where: { id: scene.id },
            data: {
                status: 'completed',
                videoUrl: renderResult.videoUrl,
                thumbnailUrl: renderResult.thumbnailUrl ?? null,
                audioUrl: audio.audioUrl || null,
                actualDuration,
                manimCode, // Store the working Manim code
                correctionAttempts,
                errorMessage: null, // clear any prior failure
            },
        });

        console.log(`✅ [${sceneLabel}] Completed (${correctionAttempts} corrections, ${actualDuration}s)`);

        return {
            sceneId: scene.id,
            sceneNumber: scene.sceneNumber,
            status: 'completed',
            videoUrl: renderResult.videoUrl,
            audioUrl: audio.audioUrl,
            duration: actualDuration,
            correctionAttempts,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return failScene(scene, sceneLabel, errorMessage, correctionAttempts);
    }
}

/** Mark a scene failed, recording why so admins need not read server logs. */
async function failScene(
    scene: SceneInput,
    sceneLabel: string,
    errorMessage: string,
    correctionAttempts: number
): Promise<SceneProcessingResult> {
    console.error(`❌ [${sceneLabel}] Processing failed:`, errorMessage);

    await prisma.scene.update({
        where: { id: scene.id },
        data: {
            status: 'failed',
            errorMessage: errorMessage.slice(0, 2000), // cap so a stack trace doesn't bloat the row
            correctionAttempts,
        },
    }).catch(() => { /* the scene row may be gone; the result still reports the failure */ });

    return {
        sceneId: scene.id,
        sceneNumber: scene.sceneNumber,
        status: 'failed',
        correctionAttempts,
        error: errorMessage,
    };
}

// ==========================================
// MAIN ORCHESTRATION
// ==========================================

/**
 * Process all scenes in a storyboard through the full pipeline.
 * Updates the DB as it goes (status, videoUrl, audioUrl).
 */
export async function processStoryboardScenes(
    storyboardId: string
): Promise<OrchestrationResult> {
    // Wrap the whole video so every nested LLM call — across all concurrent
    // scene workers — totals into one per-video cost line.
    return withUsageRun(`storyboard ${storyboardId}`, () =>
        processStoryboardScenesInner(storyboardId)
    );
}

async function processStoryboardScenesInner(
    storyboardId: string
): Promise<OrchestrationResult> {
    console.log(`\n🎬 Starting orchestration for storyboard: ${storyboardId}`);

    const storyboard = await prisma.storyboard.findUnique({
        where: { id: storyboardId },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
    });

    if (!storyboard) {
        throw new Error(`Storyboard not found: ${storyboardId}`);
    }

    await prisma.storyboard.update({
        where: { id: storyboardId },
        data: { status: 'processing' },
    });

    const scenes: SceneInput[] = storyboard.scenes;
    const totalScenes = scenes.length;
    const overallTopic = storyboard.prompt;
    console.log(
        `📊 Processing ${totalScenes} scenes ` +
        `(narrate ×${PARALLEL_CONCURRENCY} → code-gen sequential → render ×${PARALLEL_CONCURRENCY})`
    );

    const preps: ScenePrep[] = scenes.map((scene) => ({
        scene,
        audio: { audioUrl: '', duration: 0 },
        targetDuration: scene.estimatedDuration,
        manimCode: null,
        error: null,
    }));

    // --- Phase 1: narrate (parallel) ---
    console.log(`\n🎙️ Phase 1/3 — narrating ${totalScenes} scenes...`);
    await runPool(preps, PARALLEL_CONCURRENCY, async (prep) => {
        const label = `Scene ${prep.scene.sceneNumber}`;
        const { audio, targetDuration } = await narrateScene(prep.scene, label);
        prep.audio = audio;
        prep.targetDuration = targetDuration;
    });

    // --- Phase 2: write code (sequential — this is what makes continuity work) ---
    console.log(`\n🎨 Phase 2/3 — writing animation code in scene order...`);
    const contextEntries: SceneContextEntry[] = [];
    for (const prep of preps) {
        const { scene } = prep;
        const label = `Scene ${scene.sceneNumber}`;
        try {
            prep.manimCode = await writeSceneCode(scene, label, {
                overallTopic,
                totalScenes,
                targetDuration: prep.targetDuration,
                previousSceneContext: buildSceneContext(contextEntries),
            });
        } catch (error) {
            prep.error = error instanceof Error ? error.message : 'Unknown error';
            console.error(`❌ [${label}] Code generation failed: ${prep.error}`);
        }

        // Recorded either way, in scene order. A scene that failed to generate
        // still happened in the lesson, and saying so explicitly beats letting
        // its absence read as "nothing was established here".
        contextEntries.push({
            sceneNumber: scene.sceneNumber,
            narration: scene.narration,
            visualDescription: scene.visualDescription,
            manimCode: prep.manimCode,
        });
    }

    // --- Phase 3: render (parallel — the expensive stage) ---
    const renderable = preps.filter((p) => !p.error && p.manimCode);
    console.log(
        `\n🎬 Phase 3/3 — rendering ${renderable.length}/${totalScenes} scenes ` +
        `(concurrency: ${PARALLEL_CONCURRENCY})...`
    );

    const results: SceneProcessingResult[] = [];
    // Scenes that never got code cannot be rendered; record them now.
    for (const prep of preps) {
        if (prep.error || !prep.manimCode) {
            results.push(
                await failScene(
                    prep.scene,
                    `Scene ${prep.scene.sceneNumber}`,
                    prep.error || 'No Manim code was generated for this scene',
                    0
                )
            );
        }
    }

    await runPool(renderable, PARALLEL_CONCURRENCY, async (prep) => {
        const label = `Scene ${prep.scene.sceneNumber}`;
        try {
            results.push(await renderScene(prep, label));
        } catch (err) {
            // renderScene catches its own errors, but guard the pool so one
            // unexpected throw cannot kill a worker and strand the queue.
            const msg = (err as Error)?.message || 'Unknown error';
            results.push(await failScene(prep.scene, label, msg, 0));
        }
    });

    // Aggregate
    const completedScenes = results.filter((r) => r.status === 'completed').length;
    const failedScenes = results.filter((r) => r.status === 'failed').length;

    // A partially completed storyboard is still watchable, so it counts as
    // completed; only a total wipeout is a failure.
    const storyboardStatus = completedScenes > 0 ? 'completed' : 'failed';

    await prisma.storyboard.update({
        where: { id: storyboardId },
        data: { status: storyboardStatus },
    });

    console.log(`\n✅ Orchestration complete: ${completedScenes}/${totalScenes} scenes succeeded`);

    return {
        storyboardId,
        status:
            completedScenes === totalScenes
                ? 'completed'
                : completedScenes > 0
                    ? 'partially_completed'
                    : 'failed',
        totalScenes,
        completedScenes,
        failedScenes,
        results,
    };
}

// ==========================================
// SINGLE SCENE PROCESSING
// ==========================================

/**
 * Run one scene through all three phases. Used to retry a single failed scene
 * from the dashboard, where there is nothing to parallelise.
 */
export async function processScene(
    scene: SceneInput,
    overallTopic: string,
    storyboardTitle: string,
    totalScenes: number,
    previousSceneContext: string
): Promise<SceneProcessingResult> {
    const sceneLabel = `Scene ${scene.sceneNumber}`;
    console.log(`\n🎬 [${sceneLabel}] Starting processing...`);

    try {
        // narrateScene marks the scene 'processing' as it starts.
        const { audio, targetDuration } = await narrateScene(scene, sceneLabel);

        const manimCode = await writeSceneCode(scene, sceneLabel, {
            overallTopic,
            totalScenes,
            targetDuration,
            previousSceneContext,
        });

        return await renderScene(
            { scene, audio, targetDuration, manimCode, error: null },
            sceneLabel
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return failScene(scene, sceneLabel, errorMessage, 0);
    }
}

// ==========================================
// EXPORT
// ==========================================

export default {
    processStoryboardScenes,
};
