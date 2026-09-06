import axios, { AxiosError } from 'axios';

// ==========================================
// TYPES
// ==========================================

interface RenderResult {
    success: boolean;
    videoUrl: string;
    sceneId: string;
    duration: number;
    renderTime: number;
}

interface CodeRenderResult {
    success: boolean;
    videoUrl?: string;
    // First-frame thumbnail (Supabase URL) used as the dashboard scene
    // poster. Optional — falls back to a gradient placeholder when absent.
    thumbnailUrl?: string;
    sceneId: string;
    duration?: number;
    renderTime?: number;
    error?: string;
    errorType?: string;
    parsedError?: string;
    detailsStdout?: string;
    detailsStderr?: string;
    lintError?: boolean;
}

interface AssembleResult {
    success: boolean;
    videoUrl: string;
    storyboardId: string;
    totalDuration: number;
    scenesCount: number;
}

interface SceneData {
    videoUrl: string;
    audioUrl: string;
    duration: number;
    sceneNumber: number;
}

// ==========================================
// CONFIGURATION
// ==========================================

const RENDERER_URL = process.env.RENDERER_URL || 'http://localhost:5000';
// Must exceed the renderer's WORST case, not its render cap. Since renders now
// queue behind a global concurrency limit, a request can wait
// RENDER_QUEUE_TIMEOUT (240s default) before its 300s render even starts. At the
// old 300s this client aborted mid-render and the scene was recorded as failed
// while the renderer was still working on it — and the retry queued behind the
// very work it had abandoned.
const RENDER_QUEUE_WAIT = Number(process.env.RENDER_QUEUE_TIMEOUT) || 240;
const RENDER_TIMEOUT = (RENDER_QUEUE_WAIT + 300 + 60) * 1000; // queue + render + slack
const ASSEMBLE_TIMEOUT = 600000; // 10 minutes

/**
 * Output quality for every scene render and the final assembly.
 *
 * 'medium' is 1280x720 @30fps. 'high' (1920x1080 @60fps) was measured at 2x the
 * render time — 1.9s -> 3.8s per scene locally — and deliberately NOT adopted:
 * the renderer has no global concurrency cap, so two users generating at once
 * already run 4 concurrent Manim processes on a 2 vCPU Space. Doubling per-render
 * cost on top of that trades a sharpness gain for a stability risk.
 *
 * Revisit once the renderer caps concurrent renders. Until then the encode-side
 * gain is where the quality came from: the audio-stitch pass now runs crf 18 /
 * preset slow instead of crf 23 / preset fast, measured at SSIM 0.998885 ->
 * 0.999524 for the same 0.4s, so the second encode is close to lossless.
 *
 * Override per-deploy with RENDER_QUALITY=high|low|ultra.
 */
const RENDER_QUALITY = process.env.RENDER_QUALITY || 'medium';

/**
 * Shared secret proving a request came from this API server.
 *
 * The renderer executes arbitrary Python; without this anyone who can reach the
 * Space can run code in a container holding SUPABASE_SERVICE_ROLE_KEY. Must
 * match RENDERER_SHARED_SECRET on the renderer. When unset here AND there, the
 * renderer serves unauthenticated and warns — set it in both places.
 */
const RENDERER_SECRET = process.env.RENDERER_SHARED_SECRET || '';

/** Headers for every renderer call. */
function rendererHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        ...(RENDERER_SECRET ? { 'X-Renderer-Token': RENDERER_SECRET } : {}),
        ...extra,
    };
}

if (!RENDERER_SECRET) {
    console.warn(
        '⚠️  RENDERER_SHARED_SECRET is not set — renderer calls are unauthenticated. ' +
        'Set it here and on the renderer to close an open code-execution endpoint.'
    );
}

// ==========================================
// RENDER SERVICE — Full Python Code Mode
// ==========================================

/**
 * Send full Manim Python code to the renderer for execution.
 * Returns structured results including error details for correction.
 */
export async function triggerRendererWithCode(
    sceneId: string,
    manimCode: string,
    quality: string = RENDER_QUALITY
): Promise<CodeRenderResult> {
    console.log(`🎨 Triggering code renderer for scene: ${sceneId}`);
    console.log(`📊 Code length: ${manimCode.length} chars, Quality: ${quality}`);

    try {
        const response = await axios.post(
            `${RENDERER_URL}/render-code`,
            {
                sceneId,
                manimCode,
                quality,
            },
            {
                timeout: RENDER_TIMEOUT,
                headers: rendererHeaders(),
            }
        );

        if (!response.data.success) {
            // Renderer returned a structured error — pass it upstream for correction
            return {
                success: false,
                sceneId,
                error: response.data.error,
                errorType: response.data.error_type || response.data.errorType,
                parsedError: response.data.parsed_error || response.data.parsedError,
                detailsStdout: response.data.details_stdout || response.data.detailsStdout,
                detailsStderr: response.data.details_stderr || response.data.detailsStderr,
                lintError: response.data.lint_error || false,
            };
        }

        // Keep the renderer's /videos/ path as-is — needed by the /assemble endpoint
        const videoUrl = response.data.videoUrl || '';
        const thumbnailUrl = response.data.thumbnailUrl || undefined;

        console.log(`✅ Code render complete: ${videoUrl}${thumbnailUrl ? ' + thumb' : ''}`);

        return {
            success: true,
            videoUrl,
            thumbnailUrl,
            sceneId: response.data.sceneId || sceneId,
            duration: response.data.duration,
            renderTime: response.data.renderTime,
        };
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<any>;

            if (axiosError.code === 'ECONNREFUSED') {
                throw new Error('Renderer service is not running. Start it with: docker compose up renderer');
            }

            // Renderer returned 400/500 with structured error data
            if (axiosError.response?.data) {
                const data = axiosError.response.data;
                return {
                    success: false,
                    sceneId,
                    error: data.error || 'Rendering failed',
                    errorType: data.error_type || data.errorType,
                    parsedError: data.parsed_error || data.parsedError,
                    detailsStdout: data.details_stdout || data.detailsStdout,
                    detailsStderr: data.details_stderr || data.detailsStderr,
                    lintError: !!data.lint_error,
                };
            }

            throw new Error(`Renderer request failed: ${axiosError.message}`);
        }

        throw error;
    }
}

// ==========================================
// RENDER SERVICE — Operation Strings (Legacy)
// ==========================================

/**
 * Trigger the renderer service to render a single scene (legacy operation-string mode)
 */
export async function triggerRenderer(
    sceneId: string,
    manimOperations: string[] | string,
    duration: number,
    quality: string = 'medium'
): Promise<RenderResult> {
    console.log(`🎨 Triggering renderer for scene: ${sceneId}`);

    // Handle both array of operations (legacy) and raw Python string (new)
    const manimCode = Array.isArray(manimOperations)
        ? manimOperations.join('\n')
        : manimOperations;

    console.log(`📊 Code length: ${manimCode.length} chars, Duration: ${duration}s, Quality: ${quality}`);

    try {
        const response = await axios.post(
            `${RENDERER_URL}/render`,
            {
                sceneId,
                manimCode,
                duration,
                quality,
            },
            {
                timeout: RENDER_TIMEOUT,
                headers: rendererHeaders(),
            }
        );

        if (!response.data.success) {
            throw new Error(response.data.error || 'Rendering failed');
        }

        // Keep the renderer's /videos/ path as-is
        const videoUrl = response.data.videoUrl;

        console.log(`✅ Render complete: ${videoUrl}`);

        return {
            success: true,
            videoUrl,
            sceneId: response.data.sceneId,
            duration: response.data.duration,
            renderTime: response.data.renderTime,
        };
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<{ error?: string }>;

            if (axiosError.code === 'ECONNREFUSED') {
                throw new Error('Renderer service is not running. Start it with: docker compose up renderer');
            }

            if (axiosError.response?.status === 500) {
                throw new Error(`Renderer error: ${axiosError.response.data?.error || 'Internal server error'}`);
            }

            throw new Error(`Renderer request failed: ${axiosError.message}`);
        }

        throw error;
    }
}

/**
 * Assemble multiple scene videos into a final video
 */
export async function assembleVideo(
    storyboardId: string,
    scenes: SceneData[],
    quality: string = RENDER_QUALITY,
    title: string = ''
): Promise<AssembleResult> {
    console.log(`🎞️  Assembling video for storyboard: ${storyboardId} (title='${title}')`);
    console.log(`📊 Scenes: ${scenes.length}, Quality: ${quality}`);

    try {
        const response = await axios.post(
            `${RENDERER_URL}/assemble`,
            {
                storyboardId,
                title,
                scenes: scenes.map((s) => ({
                    videoUrl: s.videoUrl,
                    audioUrl: s.audioUrl,
                    duration: s.duration,
                    sceneNumber: s.sceneNumber,
                })),
                quality,
            },
            {
                timeout: ASSEMBLE_TIMEOUT,
                headers: rendererHeaders(),
            }
        );

        if (!response.data.success) {
            throw new Error(response.data.error || 'Video assembly failed');
        }

        // Keep the renderer's /videos/ path as-is
        const videoUrl = response.data.videoUrl;

        console.log(`✅ Assembly complete: ${videoUrl}`);

        return {
            success: true,
            videoUrl,
            storyboardId: response.data.storyboardId,
            totalDuration: response.data.totalDuration,
            scenesCount: response.data.scenesCount,
        };
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<{ error?: string }>;

            if (axiosError.code === 'ECONNREFUSED') {
                throw new Error('Renderer service is not running. Start it with: docker compose up renderer');
            }

            throw new Error(`Assembly request failed: ${axiosError.message}`);
        }

        throw error;
    }
}

/**
 * Check renderer service health
 */
/**
 * Delete a storyboard's previously assembled final video (and voice track).
 *
 * Best-effort: a failure here must never block the rebuild that follows, so
 * this resolves rather than throwing. Deletes by the URL recorded in the
 * database, not a recomputed path — the storage path is built from the
 * storyboard title, so a title change would otherwise strand the old object
 * in the bucket permanently.
 */
export async function deleteFinalVideo(
    videoUrl?: string | null,
    audioUrl?: string | null
): Promise<{ deleted: string[]; missing: string[]; failed: unknown[] }> {
    const empty = { deleted: [], missing: [], failed: [] };
    if (!videoUrl && !audioUrl) return empty;

    try {
        const response = await axios.post(
            `${RENDERER_URL}/delete-final`,
            { videoUrl: videoUrl ?? null, audioUrl: audioUrl ?? null },
            { timeout: 30000, headers: rendererHeaders() }
        );
        const data = response.data ?? {};
        if (data.deleted?.length) {
            console.log(`🗑️  Removed previous final video: ${data.deleted.join(', ')}`);
        }
        return {
            deleted: data.deleted ?? [],
            missing: data.missing ?? [],
            failed: data.failed ?? [],
        };
    } catch (error) {
        const msg = axios.isAxiosError(error)
            ? `HTTP ${error.response?.status ?? error.code}`
            : String((error as Error)?.message ?? error);
        console.warn(`⚠️  Could not delete previous final video (${msg}) — continuing.`);
        return empty;
    }
}

/**
 * Remove a set of storage objects by the URLs recorded in the database.
 *
 * Used when a storyboard is deleted: its rows cascade away, but the per-scene
 * mp4s, mp3s and thumbnails in the bucket would otherwise be orphaned with
 * nothing left pointing at them. Roughly 6 MB per twelve-scene video, which on
 * a 1 GB free tier is the difference between ~160 videos and unbounded growth.
 *
 * Best-effort by design: cleanup must never stop a user from deleting their
 * own storyboard, so this resolves rather than throwing.
 */
export async function deleteStorageObjects(
    urls: Array<string | null | undefined>
): Promise<{ deleted: string[]; missing: string[]; failed: unknown[] }> {
    const empty = { deleted: [], missing: [], failed: [] };
    const clean = urls.filter((u): u is string => Boolean(u));
    if (clean.length === 0) return empty;

    try {
        const response = await axios.post(
            `${RENDERER_URL}/delete-final`,
            { urls: clean },
            { timeout: 60000, headers: rendererHeaders() }
        );
        const data = response.data ?? {};
        if (data.deleted?.length) {
            console.log(`🗑️  Removed ${data.deleted.length} storage object(s)`);
        }
        return {
            deleted: data.deleted ?? [],
            missing: data.missing ?? [],
            failed: data.failed ?? [],
        };
    } catch (error) {
        const msg = axios.isAxiosError(error)
            ? `HTTP ${error.response?.status ?? error.code}`
            : String((error as Error)?.message ?? error);
        console.warn(`⚠️  Storage cleanup failed (${msg}) — objects may be orphaned.`);
        return empty;
    }
}

export async function checkRendererHealth(): Promise<{
    status: string;
    uptime: number;
    stats: {
        total_renders: number;
        successful_renders: number;
        failed_renders: number;
    };
}> {
    try {
        const response = await axios.get(`${RENDERER_URL}/health`, {
            timeout: 5000,
            headers: rendererHeaders(),
        });

        return response.data;
    } catch (error) {
        throw new Error('Renderer service is not available');
    }
}

/**
 * Get renderer statistics
 */
export async function getRendererStats(): Promise<{
    uptime: number;
    total_renders: number;
    successful_renders: number;
    failed_renders: number;
    success_rate: number;
    avg_render_time: number;
}> {
    try {
        const response = await axios.get(`${RENDERER_URL}/stats`, {
            timeout: 5000,
            headers: rendererHeaders(),
        });

        return response.data;
    } catch (error) {
        throw new Error('Failed to get renderer statistics');
    }
}

// ==========================================
// EXPORT
// ==========================================

export default {
    triggerRenderer,
    triggerRendererWithCode,
    assembleVideo,
    checkRendererHealth,
    getRendererStats,
};
