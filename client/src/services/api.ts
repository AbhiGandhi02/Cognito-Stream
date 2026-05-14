import axios, { type AxiosInstance } from 'axios';
import { supabase } from '../lib/supabase';

// Types
export interface Scene {
  id: string;
  sceneNumber: number;
  narration: string;
  visualDescription: string;
  manimCode: string;
  estimatedDuration: number;
  actualDuration?: number;
  audioUrl?: string;
  videoUrl?: string;
  // First-frame jpg poster for the dashboard breakdown.
  thumbnailUrl?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface Storyboard {
  id: string;
  title: string;
  description: string;
  prompt: string;
  status: 'draft' | 'processing' | 'completed' | 'failed';
  finalVideoUrl?: string;
  totalDuration?: number;
  scenes: Scene[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateStoryboardRequest {
  prompt: string;
  autoGenerate?: boolean;
}

export interface UpdateSceneRequest {
  narration?: string;
  visualDescription?: string;
  // Raw Python source containing `class GeneratedScene(...)`.
  manimCode?: string;
}

// API Client Class
class CognitoStreamAPI {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 300000, // 5 minutes for long operations
    });

    // Inject the Supabase JWT on every request. Supabase manages refresh
    // automatically; getSession() returns the live access token.
    this.client.interceptors.request.use(
      async (config) => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // On 401, sign out and redirect to login. Token is likely stale or revoked.
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          await supabase.auth.signOut();
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Health Check
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const response = await this.client.get('/health');
    return response.data;
  }

  // ==========================================
  // ME / AUTH PROFILE
  // ==========================================

  async getMe(): Promise<{ id: string; email: string; role: 'USER' | 'ADMIN' }> {
    const response = await this.client.get('/api/me');
    return response.data;
  }

  // ==========================================
  // ADMIN
  // ==========================================

  async adminListUsers(params?: { limit?: number; offset?: number }) {
    const response = await this.client.get('/api/admin/users', { params });
    return response.data as {
      data: Array<{
        id: string;
        email: string;
        name: string | null;
        role: 'USER' | 'ADMIN';
        createdAt: string;
        storyboardCount: number;
        lastStoryboardAt: string | null;
      }>;
      pagination: { total: number; limit: number; offset: number };
    };
  }

  async adminListAllStoryboards(params?: { limit?: number; offset?: number }) {
    const response = await this.client.get('/api/admin/storyboards', { params });
    return response.data as {
      data: Array<{
        id: string;
        title: string;
        description: string;
        status: string;
        finalVideoUrl: string | null;
        totalDuration: number | null;
        createdAt: string;
        updatedAt: string;
        sceneCount: number;
        user: { id: string; email: string; role: 'USER' | 'ADMIN' } | null;
      }>;
      pagination: { total: number; limit: number; offset: number };
    };
  }

  async adminListUserStoryboards(userId: string) {
    const response = await this.client.get(`/api/admin/users/${userId}/storyboards`);
    return response.data as {
      user: {
        id: string;
        email: string;
        role: 'USER' | 'ADMIN';
        createdAt: string;
      };
      storyboards: Array<{
        id: string;
        title: string;
        prompt: string;            // the user's original input
        description: string;
        status: 'draft' | 'processing' | 'completed' | 'failed';
        errorMessage: string | null;
        totalDuration: number | null;
        createdAt: string;
        updatedAt: string;
        scenes: Array<{
          id: string;
          sceneNumber: number;
          status: 'pending' | 'processing' | 'completed' | 'failed';
          narration: string;
          visualDescription: string;
          errorMessage: string | null;
          correctionAttempts: number;
          actualDuration: number | null;
          estimatedDuration: number;
        }>;
      }>;
    };
  }

  // ==========================================
  // STORYBOARD ENDPOINTS
  // ==========================================

  /**
   * Generate a new storyboard from a prompt
   */
  async createStoryboard(data: CreateStoryboardRequest): Promise<Storyboard> {
    const response = await this.client.post('/api/storyboard', data);
    return response.data;
  }

  /**
   * Create a test storyboard without using Gemini API (for testing rendering)
   */
  async createTestStoryboard(): Promise<Storyboard> {
    const response = await this.client.post('/api/storyboard/test');
    return response.data;
  }

  /**
   * Get a storyboard by ID
   */
  async getStoryboard(id: string): Promise<Storyboard> {
    const response = await this.client.get(`/api/storyboard/${id}`);
    return response.data;
  }

  /**
   * List all storyboards
   */
  async listStoryboards(params?: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<{ data: Storyboard[]; pagination: { total: number } }> {
    const response = await this.client.get('/api/storyboard', { params });
    return response.data;
  }

  /**
   * Update a storyboard
   */
  async updateStoryboard(
    id: string,
    data: Partial<Storyboard>
  ): Promise<Storyboard> {
    const response = await this.client.patch(`/api/storyboard/${id}`, data);
    return response.data;
  }

  /**
   * Delete a storyboard
   */
  async deleteStoryboard(id: string): Promise<{ success: boolean }> {
    const response = await this.client.delete(`/api/storyboard/${id}`);
    return response.data;
  }

  /**
   * Render the complete video
   */
  async renderStoryboard(id: string): Promise<Storyboard> {
    const response = await this.client.post(`/api/storyboard/${id}/render`);
    return response.data;
  }

  // ==========================================
  // SCENE ENDPOINTS
  // ==========================================

  /**
   * Get a scene by ID
   */
  async getScene(id: string): Promise<Scene> {
    const response = await this.client.get(`/api/scene/${id}`);
    return response.data;
  }

  /**
   * Update a scene (narration, visualDescription, or raw Manim Python code).
   */
  async updateScene(id: string, data: UpdateSceneRequest): Promise<Scene> {
    const response = await this.client.patch(`/api/scene/${id}`, data);
    return response.data;
  }

  /**
   * Generate Manim code for a single scene via the LLM. Stores it on the scene
   * so a later /render call uses the stored code instead of re-generating.
   */
  async generateSceneCode(id: string): Promise<Scene> {
    const response = await this.client.post(`/api/scene/${id}/generate-code`);
    return response.data;
  }

  /**
   * Re-run the full per-scene pipeline (LLM code-gen + render + TTS) for a
   * single scene. Used for retrying failed scenes from the dashboard.
   */
  async regenerateScene(id: string): Promise<Scene> {
    const response = await this.client.post(`/api/scene/${id}/regenerate`);
    return response.data;
  }

  /**
   * Process a scene (generate audio + render video)
   */
  async processScene(id: string): Promise<Scene> {
    const response = await this.client.post(`/api/scene/${id}/process`);
    return response.data;
  }

  /**
   * Delete a scene
   */
  async deleteScene(id: string): Promise<{ success: boolean }> {
    const response = await this.client.delete(`/api/scene/${id}`);
    return response.data;
  }

  // ==========================================
  // BATCH OPERATIONS
  // ==========================================

  /**
   * Process all scenes in a storyboard
   */
  async processAllScenes(storyboardId: string): Promise<Scene[]> {
    const storyboard = await this.getStoryboard(storyboardId);
    const promises = storyboard.scenes.map((scene) =>
      this.processScene(scene.id)
    );
    return Promise.all(promises);
  }

  /**
   * Poll for scene completion
   */
  async waitForSceneCompletion(
    sceneId: string,
    maxAttempts: number = 60,
    interval: number = 2000
  ): Promise<Scene> {
    for (let i = 0; i < maxAttempts; i++) {
      const scene = await this.getScene(sceneId);

      if (scene.status === 'completed') {
        return scene;
      }

      if (scene.status === 'failed') {
        throw new Error('Scene processing failed');
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error('Scene processing timeout');
  }

  /**
   * Poll for storyboard completion
   */
  async waitForStoryboardCompletion(
    storyboardId: string,
    maxAttempts: number = 120,
    interval: number = 3000
  ): Promise<Storyboard> {
    for (let i = 0; i < maxAttempts; i++) {
      const storyboard = await this.getStoryboard(storyboardId);

      if (storyboard.status === 'completed') {
        return storyboard;
      }

      if (storyboard.status === 'failed') {
        throw new Error('Storyboard rendering failed');
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error('Storyboard rendering timeout');
  }

  // ==========================================
  // UTILITY METHODS
  // ==========================================

  /**
   * Download a video file
   */
  async downloadVideo(url: string, filename: string): Promise<void> {
    const response = await this.client.get(url, {
      responseType: 'blob',
    });

    const blob = new Blob([response.data], { type: 'video/mp4' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }

  /**
   * Get video duration from URL
   */
  async getVideoDuration(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve(video.duration);
        video.remove();
      };
      video.onerror = () => {
        reject(new Error('Failed to load video metadata'));
        video.remove();
      };
      video.src = url;
    });
  }

  /**
   * Estimate processing time
   */
  estimateProcessingTime(scenes: Scene[]): number {
    // Rough estimate: 30 seconds per scene + 1 minute for final assembly
    return scenes.length * 30 + 60;
  }

  /**
   * Get progress percentage
   */
  getProgressPercentage(storyboard: Storyboard): number {
    const totalScenes = storyboard.scenes.length;
    const completedScenes = storyboard.scenes.filter(
      (s) => s.status === 'completed'
    ).length;

    if (storyboard.status === 'completed') {
      return 100;
    }

    // Scenes are 90% of the work, final assembly is 10%
    return Math.round((completedScenes / totalScenes) * 90);
  }
}

// Export singleton instance
export const api = new CognitoStreamAPI();

// Export class for custom instances
export default CognitoStreamAPI;