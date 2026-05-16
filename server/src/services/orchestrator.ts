/**
 * Orchestrator service — coordinates the end-to-end scene processing pipeline.
 *
 * For each scene in a storyboard:
 *   1. Generate Manim Python code via Gemini
 *   2. Send code to renderer
 *   3. If rendering fails → correct code via Gemini → retry (up to MAX_CORRECTION_ATTEMPTS)
 *   4. Generate TTS audio via Piper (renderer /tts endpoint)
 *   5. Update scene in Prisma DB
 *
 * Scenes are processed in parallel with a concurrency limit.
 */

import { prisma } from '../lib/prisma';
import { generateManimSceneCode, correctManimCode, normalizeManimCode } from './gemini';
import { triggerRendererWithCode } from './renderer';
import { generateAudio } from './elevenlabs';

// ==========================================
// CONSTANTS
// ==========================================

const MAX_CORRECTION_ATTEMPTS = 3;
// Process N scenes simultaneously. Each Manim render takes 30-60s, so a
// 6-scene storyboard now runs roughly as fast as a single scene (assuming
// the renderer and LLMs can keep up). Override via SCENE_CONCURRENCY env.
// LLM rate limits are handled by the OpenRouter→Gemini→Groq fallback in
// gemini.ts; renderer load should be checked if you push this much higher.
const PARALLEL_CONCURRENCY = Number(process.env.SCENE_CONCURRENCY) || 6;

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
    console.log(`\n🎬 Starting orchestration for storyboard: ${storyboardId}`);

    // Fetch storyboard with all scenes
    const storyboard = await prisma.storyboard.findUnique({
        where: { id: storyboardId },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
    });

    if (!storyboard) {
        throw new Error(`Storyboard not found: ${storyboardId}`);
    }

    // Mark storyboard as processing
    await prisma.storyboard.update({
        where: { id: storyboardId },
        data: { status: 'processing' },
    });

    const totalScenes = storyboard.scenes.length;
    console.log(`📊 Processing ${totalScenes} scenes (concurrency: ${PARALLEL_CONCURRENCY})`);

    const results: SceneProcessingResult[] = [];

    // Accumulate a running summary of completed scenes so the LLM has narrative
    // continuity (same example array, same notation, same variables across scenes).
    const sceneSummaries: string[] = [];

    // Rolling worker pool — keep PARALLEL_CONCURRENCY scenes in flight at any
    // moment. As soon as a scene finishes, the next pending one starts. This
    // is strictly better than batched concurrency: the slowest scene in batch N
    // no longer blocks batch N+1 from starting.
    // Hoist the bits of storyboard the closures need so TS doesn't lose null
    // narrowing across the worker function boundary.
    const sbPrompt = storyboard.prompt;
    const sbTitle = storyboard.title;
    let cursor = 0;
    const queue = storyboard.scenes;
    async function worker() {
        while (true) {
            const idx = cursor++;
            if (idx >= queue.length) return;
            const scene = queue[idx];
            // Snapshot the running summaries at task start. Slightly racy with
            // other workers, but the only effect is that some scenes may not
            // see siblings that started microseconds earlier — acceptable.
            const previousSceneContext = sceneSummaries.join('\n');
            try {
                const result = await processScene(
                    scene,
                    sbPrompt,
                    sbTitle,
                    totalScenes,
                    previousSceneContext
                );
                results.push(result);
                if (result.status === 'completed') {
                    sceneSummaries.push(
                        `Scene ${scene.sceneNumber} ("${scene.visualDescription.slice(0, 80)}"): ${scene.narration.slice(0, 200)}`
                    );
                }
            } catch (err) {
                // processScene already catches its own errors, but guard the
                // pool against an unexpected throw so one bad scene doesn't
                // kill an entire worker.
                results.push({
                    sceneId: scene.id,
                    sceneNumber: scene.sceneNumber,
                    status: 'failed',
                    correctionAttempts: 0,
                    error: (err as Error)?.message || 'Unknown error',
                });
            }
        }
    }

    const concurrency = Math.min(PARALLEL_CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Aggregate results
    const completedScenes = results.filter((r) => r.status === 'completed').length;
    const failedScenes = results.filter((r) => r.status === 'failed').length;

    let storyboardStatus: string;
    if (completedScenes === totalScenes) {
        storyboardStatus = 'completed';
    } else if (completedScenes > 0) {
        storyboardStatus = 'completed'; // Partially completed but usable
    } else {
        storyboardStatus = 'failed';
    }

    // Update storyboard status
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
 * Process a single scene through the full pipeline:
 *   generate code → render → (correct if needed) → TTS → update DB
 */
export async function processScene(
    scene: {
        id: string;
        sceneNumber: number;
        narration: string;
        visualDescription: string;
        estimatedDuration: number;
        manimCode: string;
    },
    overallTopic: string,
    storyboardTitle: string,
    totalScenes: number,
    previousSceneContext: string
): Promise<SceneProcessingResult> {
    const sceneLabel = `Scene ${scene.sceneNumber}`;
    console.log(`\n🎬 [${sceneLabel}] Starting processing...`);

    // Hoisted so the catch block can persist the count alongside the error.
    let correctionAttempts = 0;

    try {
        // Mark scene as processing
        await prisma.scene.update({
            where: { id: scene.id },
            data: { status: 'processing' },
        });

        // --- Step 1: Generate Manim code (or reuse pre-stored code) ---
        let manimCode: string;

        // If the scene already has a complete Manim script, skip AI generation
        if (scene.manimCode && scene.manimCode.includes('class GeneratedScene')) {
            console.log(`♻️ [${sceneLabel}] Using pre-stored Manim code (no AI call)`);
            // Apply auto-fix transforms to the cached code too — older
            // storyboards may have buggy code persisted before the transforms
            // existed. Idempotent: a clean script passes through unchanged.
            manimCode = normalizeManimCode(scene.manimCode);
        } else {
            console.log(`🎨 [${sceneLabel}] Generating Manim code via AI...`);

            // Parse the scene title from manimCode or use a default
            let sceneTitle = `Scene ${scene.sceneNumber}`;
            try {
                const parsed = JSON.parse(scene.manimCode);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    sceneTitle = parsed[0].substring(0, 50);
                }
            } catch {
                // manimCode may not be JSON, that's fine
            }

            manimCode = await generateManimSceneCode({
                sceneTitle,
                narration: scene.narration,
                visualDescription: scene.visualDescription,
                duration: scene.estimatedDuration,
                sceneNumber: scene.sceneNumber,
                totalScenes,
                overallTopic,
                previousSceneContext: previousSceneContext || undefined,
            });

            // Persist the freshly generated code BEFORE attempting render so a
            // render failure doesn't lose what we got from the LLM. The final
            // write at the bottom of this function will overwrite this with
            // the corrected version if the correction loop runs.
            await prisma.scene.update({
                where: { id: scene.id },
                data: { manimCode },
            });
        }

        // --- Step 2: Render with correction loop ---
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

        // --- Step 3: Generate TTS audio ---
        console.log(`🎙️ [${sceneLabel}] Generating audio...`);
        const audioResult = await generateAudio(scene.narration, scene.id);

        // --- Step 4: Update scene in DB ---
        const actualDuration = renderResult.duration || audioResult.duration || scene.estimatedDuration;

        await prisma.scene.update({
            where: { id: scene.id },
            data: {
                status: 'completed',
                videoUrl: renderResult.videoUrl,
                thumbnailUrl: renderResult.thumbnailUrl ?? null,
                audioUrl: audioResult.audioUrl || null,
                actualDuration,
                manimCode: manimCode, // Store the working Manim code
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
            audioUrl: audioResult.audioUrl,
            duration: actualDuration,
            correctionAttempts,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ [${sceneLabel}] Processing failed:`, errorMessage);

        // Mark scene as failed AND record the error + attempts so admins can
        // see why it broke without scrolling server logs.
        await prisma.scene.update({
            where: { id: scene.id },
            data: {
                status: 'failed',
                errorMessage: errorMessage.slice(0, 2000), // cap so a stack trace doesn't bloat the row
                correctionAttempts,
            },
        });

        return {
            sceneId: scene.id,
            sceneNumber: scene.sceneNumber,
            status: 'failed',
            correctionAttempts,
            error: errorMessage,
        };
    }
}

// ==========================================
// EXPORT
// ==========================================

export default {
    processStoryboardScenes,
};
