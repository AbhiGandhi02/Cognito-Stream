/**
 * Cognito Stream - Shared TypeScript Type Definitions
 * Used across client, server, and API interfaces
 */

// ==========================================
// ENUMS
// ==========================================

export enum StoryboardStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum SceneStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum RenderQuality {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  ULTRA = 'ultra',
}

// ==========================================
// CORE ENTITIES
// ==========================================

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Storyboard {
  id: string;
  title: string;
  description: string;
  prompt: string;
  status: StoryboardStatus;
  finalVideoUrl?: string;
  totalDuration?: number;
  scenes: Scene[];
  createdAt: Date;
  updatedAt: Date;
  userId?: string;
}

export interface Scene {
  id: string;
  storyboardId: string;
  sceneNumber: number;
  narration: string;
  visualDescription: string;
  manimCode: string; // JSON stringified array of operations
  estimatedDuration: number;
  actualDuration?: number;
  audioUrl?: string;
  videoUrl?: string;
  status: SceneStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface RenderJob {
  id: string;
  sceneId?: string;
  storyboardId?: string;
  type: 'scene' | 'final';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ==========================================
// API REQUEST/RESPONSE TYPES
// ==========================================

// Storyboard Requests
export interface CreateStoryboardRequest {
  prompt: string;
  userId?: string;
}

export interface UpdateStoryboardRequest {
  title?: string;
  description?: string;
  status?: StoryboardStatus;
}

export interface StoryboardListQuery {
  limit?: number;
  offset?: number;
  status?: StoryboardStatus;
  userId?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

// Scene Requests
export interface UpdateSceneRequest {
  narration?: string;
  manimCode?: string[] | string;
  visualDescription?: string;
}

export interface ProcessSceneRequest {
  sceneId: string;
  quality?: RenderQuality;
}

// Renderer Requests
export interface RenderSceneRequest {
  sceneId: string;
  manimCode: string | string[];
  duration: number;
  quality?: RenderQuality;
}

export interface AssembleVideoRequest {
  storyboardId: string;
  scenes: {
    videoUrl: string;
    audioUrl: string;
    duration: number;
  }[];
  quality?: RenderQuality;
}

// ==========================================
// GEMINI AI TYPES
// ==========================================

export interface GeminiStoryboardScene {
  id: string;
  narration: string;
  visualDescription: string;
  manimOperations: string[];
  estimatedDuration: number;
}

export interface GeminiStoryboardResponse {
  title: string;
  description: string;
  scenes: GeminiStoryboardScene[];
}

export interface GeminiPromptConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}

// ==========================================
// ELEVENLABS TTS TYPES
// ==========================================

export interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export interface ElevenLabsTTSRequest {
  text: string;
  model_id?: string;
  voice_settings?: ElevenLabsVoiceSettings;
}

export interface ElevenLabsTTSResponse {
  audioUrl: string;
  duration: number;
  characterCount: number;
}

// ==========================================
// MANIM TYPES
// ==========================================

export interface ManimOperation {
  type: 'create' | 'transform' | 'animate';
  code: string;
  duration?: number;
}

export interface ManimScene {
  operations: ManimOperation[];
  backgroundColor?: string;
  resolution?: [number, number];
  fps?: number;
}

export interface ManimRenderConfig {
  quality: RenderQuality;
  transparent?: boolean;
  format?: 'mp4' | 'mov' | 'gif';
  fps?: number;
  resolution?: [number, number];
}

// ==========================================
// RENDERER SERVICE TYPES
// ==========================================

export interface RendererHealthResponse {
  status: 'ok' | 'error';
  service: string;
  version?: string;
  uptime?: number;
}

export interface RenderSceneResponse {
  success: boolean;
  videoUrl: string;
  sceneId: string;
  duration?: number;
  error?: string;
}

export interface AssembleVideoResponse {
  success: boolean;
  videoUrl: string;
  storyboardId: string;
  totalDuration: number;
  error?: string;
}

// ==========================================
// WEBSOCKET EVENT TYPES
// ==========================================

export enum WebSocketEventType {
  SCENE_PROCESSING_STARTED = 'scene:processing:started',
  SCENE_PROCESSING_PROGRESS = 'scene:processing:progress',
  SCENE_PROCESSING_COMPLETED = 'scene:processing:completed',
  SCENE_PROCESSING_FAILED = 'scene:processing:failed',
  STORYBOARD_RENDERING_STARTED = 'storyboard:rendering:started',
  STORYBOARD_RENDERING_PROGRESS = 'storyboard:rendering:progress',
  STORYBOARD_RENDERING_COMPLETED = 'storyboard:rendering:completed',
  STORYBOARD_RENDERING_FAILED = 'storyboard:rendering:failed',
}

export interface WebSocketEvent {
  type: WebSocketEventType;
  payload: any;
  timestamp: Date;
}

export interface SceneProcessingEvent extends WebSocketEvent {
  payload: {
    sceneId: string;
    status: SceneStatus;
    progress?: number;
    message?: string;
    error?: string;
  };
}

export interface StoryboardRenderingEvent extends WebSocketEvent {
  payload: {
    storyboardId: string;
    status: StoryboardStatus;
    progress?: number;
    completedScenes?: number;
    totalScenes?: number;
    message?: string;
    error?: string;
  };
}

// ==========================================
// ERROR TYPES
// ==========================================

export interface APIError {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
}

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  GEMINI_API_ERROR = 'GEMINI_API_ERROR',
  ELEVENLABS_API_ERROR = 'ELEVENLABS_API_ERROR',
  RENDERER_ERROR = 'RENDERER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}

export class CognitoStreamError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'CognitoStreamError';
  }
}

// ==========================================
// UTILITY TYPES
// ==========================================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface ProgressInfo {
  current: number;
  total: number;
  percentage: number;
  estimatedTimeRemaining?: number;
}

// ==========================================
// ANALYTICS TYPES
// ==========================================

export interface StoryboardAnalytics {
  totalStoryboards: number;
  completedStoryboards: number;
  totalScenes: number;
  averageDuration: number;
  totalRenderTime: number;
  successRate: number;
}

export interface UserAnalytics {
  userId: string;
  storyboardsCreated: number;
  videosGenerated: number;
  totalDuration: number;
  favoriteTopics: string[];
}

// ==========================================
// STORAGE TYPES
// ==========================================

export interface StorageConfig {
  provider: 's3' | 'gcs' | 'local';
  bucket?: string;
  region?: string;
  basePath?: string;
}

export interface UploadResult {
  url: string;
  key: string;
  size: number;
  contentType: string;
}

// ==========================================
// CONFIGURATION TYPES
// ==========================================

export interface AppConfig {
  server: {
    port: number;
    host: string;
    corsOrigin: string[];
  };
  database: {
    url: string;
  };
  gemini: {
    apiKey: string;
    model: string;
  };
  elevenlabs: {
    apiKey: string;
    voiceId: string;
  };
  renderer: {
    url: string;
    timeout: number;
  };
  storage: StorageConfig;
}

// ==========================================
// TYPE GUARDS
// ==========================================

export function isStoryboard(obj: any): obj is Storyboard {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    Array.isArray(obj.scenes)
  );
}

export function isScene(obj: any): obj is Scene {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.sceneNumber === 'number' &&
    typeof obj.narration === 'string'
  );
}

export function isAPIError(obj: any): obj is APIError {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.code === 'string' &&
    typeof obj.message === 'string'
  );
}

// ==========================================
// EXPORT ALL TYPES
// ==========================================

export type {
  User,
  Storyboard,
  Scene,
  RenderJob,
  CreateStoryboardRequest,
  UpdateStoryboardRequest,
  StoryboardListQuery,
  UpdateSceneRequest,
  ProcessSceneRequest,
  RenderSceneRequest,
  AssembleVideoRequest,
  GeminiStoryboardScene,
  GeminiStoryboardResponse,
  GeminiPromptConfig,
  ElevenLabsVoiceSettings,
  ElevenLabsTTSRequest,
  ElevenLabsTTSResponse,
  ManimOperation,
  ManimScene,
  ManimRenderConfig,
  RendererHealthResponse,
  RenderSceneResponse,
  AssembleVideoResponse,
  WebSocketEvent,
  SceneProcessingEvent,
  StoryboardRenderingEvent,
  APIError,
  PaginatedResponse,
  TimeRange,
  ProgressInfo,
  StoryboardAnalytics,
  UserAnalytics,
  StorageConfig,
  UploadResult,
  AppConfig,
};