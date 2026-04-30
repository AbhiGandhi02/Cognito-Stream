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
import { generateManimSceneCode, correctManimCode } from './gemini';
import { triggerRendererWithCode } from './renderer';
import { generateAudio } from './elevenlabs';

// ==========================================
// CONSTANTS
// ==========================================

const MAX_CORRECTION_ATTEMPTS = 2;
// Process N scenes simultaneously. Each Manim render takes 30-60s, so
// concurrency 3 cuts an 8-scene pipeline from ~6min to ~2min on a 4-CPU container.
// LLM rate limits are handled by the Gemini→Groq fallback in gemini.ts.
const PARALLEL_CONCURRENCY = Number(process.env.SCENE_CONCURRENCY) || 3;

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

    // Process scenes in batches for controlled concurrency
    for (let i = 0; i < storyboard.scenes.length; i += PARALLEL_CONCURRENCY) {
        const batch = storyboard.scenes.slice(i, i + PARALLEL_CONCURRENCY);
        const previousSceneContext = sceneSummaries.join('\n');

        const batchResults = await Promise.allSettled(
            batch.map((scene) =>
                processScene(
                    scene,
                    storyboard.prompt,
                    storyboard.title,
                    totalScenes,
                    previousSceneContext
                )
            )
        );

        for (const result of batchResults) {
            if (result.status === 'fulfilled') {
                results.push(result.value);
                // Add a brief summary of this scene for downstream scenes' context.
                const sourceScene = batch.find((s) => s.id === result.value.sceneId);
                if (sourceScene && result.value.status === 'completed') {
                    sceneSummaries.push(
                        `Scene ${sourceScene.sceneNumber} ("${sourceScene.visualDescription.slice(0, 80)}"): ${sourceScene.narration.slice(0, 200)}`
                    );
                }
            } else {
                // This shouldn't happen since processScene catches errors internally
                results.push({
                    sceneId: 'unknown',
                    sceneNumber: 0,
                    status: 'failed',
                    correctionAttempts: 0,
                    error: result.reason?.message || 'Unknown error',
                });
            }
        }
    }

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
async function processScene(
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
            manimCode = scene.manimCode;
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

                renderResult = await triggerRendererWithCode(scene.id, manimCode);
            } catch (correctionError) {
                console.error(`❌ [${sceneLabel}] Code correction failed:`, correctionError);
                // Continue loop — next attempt may succeed
            }
        }

        if (!renderResult.success) {
            throw new Error(
                `Rendering failed after ${correctionAttempts} correction attempts: ${renderResult.error}`
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
