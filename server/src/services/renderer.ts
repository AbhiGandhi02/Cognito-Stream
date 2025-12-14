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
// RENDER SERVICE
// ==========================================

/**
 * Trigger the renderer service to render a single scene
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

        console.log(`✅ Render complete: ${response.data.videoUrl}`);

        return {
            success: true,
            videoUrl: response.data.videoUrl,
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

        console.log(`✅ Assembly complete: ${response.data.videoUrl}`);

        return {
            success: true,
            videoUrl: response.data.videoUrl,
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
    assembleVideo,
    checkRendererHealth,
    getRendererStats,
};
