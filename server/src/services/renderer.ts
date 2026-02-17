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
const RENDER_TIMEOUT = 300000; // 5 minutes
const ASSEMBLE_TIMEOUT = 600000; // 10 minutes

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
    quality: string = 'medium'
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
                headers: {
                    'Content-Type': 'application/json',
                },
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

        // Transform renderer's /videos/ path to server's /video/ path
        const videoUrl = response.data.videoUrl?.replace('/videos/', '/video/') || '';

        console.log(`✅ Code render complete: ${videoUrl}`);

        return {
            success: true,
            videoUrl,
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
    manimOperations: string[],
    duration: number,
    quality: string = 'medium'
): Promise<RenderResult> {
    console.log(`🎨 Triggering renderer for scene: ${sceneId}`);
    console.log(`📊 Operations: ${manimOperations.length}, Duration: ${duration}s, Quality: ${quality}`);

    try {
        const response = await axios.post(
            `${RENDERER_URL}/render`,
            {
                sceneId,
                manimCode: manimOperations.join('\n'),
                duration,
                quality,
            },
            {
                timeout: RENDER_TIMEOUT,
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!response.data.success) {
            throw new Error(response.data.error || 'Rendering failed');
        }

        // Transform renderer's /videos/ path to server's /video/ path
        const videoUrl = response.data.videoUrl.replace('/videos/', '/video/');

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
    quality: string = 'medium'
): Promise<AssembleResult> {
    console.log(`🎞️  Assembling video for storyboard: ${storyboardId}`);
    console.log(`📊 Scenes: ${scenes.length}, Quality: ${quality}`);

    try {
        const response = await axios.post(
            `${RENDERER_URL}/assemble`,
            {
                storyboardId,
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
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!response.data.success) {
            throw new Error(response.data.error || 'Video assembly failed');
        }

        // Transform renderer's /videos/ path to server's /video/ path
        const videoUrl = response.data.videoUrl.replace('/videos/', '/video/');

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
