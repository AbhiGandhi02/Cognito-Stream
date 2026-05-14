import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import axios from 'axios';
import {
  MANIM_CODE_SYSTEM_PROMPT,
  CODE_CORRECTION_SYSTEM_PROMPT,
  buildCodeGenPrompt,
  buildCodeCorrectionPrompt,
  type SceneCodeGenParams,
  type CodeCorrectionParams,
} from './prompts';

// ==========================================
// TYPES
// ==========================================

interface StoryboardScene {
  id: string;
  narration: string;
  visualDescription: string;
  manimOperations: string[];
  estimatedDuration: number;
}

interface StoryboardResponse {
  title: string;
  description: string;
  scenes: StoryboardScene[];
}

// ==========================================
// CONFIGURATION
// ==========================================

// Primary key is preferred. Secondary is a manual fallback used only when the
// primary is unset/empty — swap by clearing GEMINI_API_KEY_PRIMARY in the env.
// Legacy GEMINI_API_KEY is honored so existing deploys keep working.
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY_PRIMARY ||
  process.env.GEMINI_API_KEY_SECONDARY ||
  process.env.GEMINI_API_KEY ||
  '';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });

// OpenRouter is OpenAI-compatible — we hit the REST endpoint with axios.
// Default model: DeepSeek V3.1 free tier (best free code model as of 2026).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3.1:free';
const OPENROUTER_ENABLED = OPENROUTER_API_KEY.length > 0;

// ==========================================
// LLM FALLBACK (OpenRouter → Gemini → Groq)
// ==========================================

interface LLMCallOptions {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  // Override the Gemini model for a single call (e.g. 'gemini-2.5-pro' for code).
  // Falls back to GEMINI_MODEL env, then 'gemini-2.5-flash'.
  geminiModel?: string;
  // Skip the cascade and call exactly one provider. Useful for the code-gen
  // retry rotation (force a different provider on each attempt) and for tests.
  forceProvider?: 'openrouter' | 'gemini' | 'groq';
}

// Module-local cooldown: when a provider reports quota/auth/server error we
// skip it for 30 minutes and route to the next tier. Resets on server restart.
const COOLDOWN_MS = 30 * 60 * 1000;
let geminiBlockedUntil = 0;
let openRouterBlockedUntil = 0;

function isGeminiBlocked(): boolean {
  return Date.now() < geminiBlockedUntil;
}

function blockGemini(reason: string): void {
  geminiBlockedUntil = Date.now() + COOLDOWN_MS;
  const minutes = Math.round(COOLDOWN_MS / 60000);
  console.warn(`⚠️  Gemini cooldown for ${minutes}min — falling back to next provider. (${reason})`);
}

function isOpenRouterBlocked(): boolean {
  return Date.now() < openRouterBlockedUntil;
}

function blockOpenRouter(reason: string): void {
  openRouterBlockedUntil = Date.now() + COOLDOWN_MS;
  const minutes = Math.round(COOLDOWN_MS / 60000);
  console.warn(`⚠️  OpenRouter cooldown for ${minutes}min — falling back to next provider. (${reason})`);
}

type GeminiErrorCategory = 'quota' | 'auth' | 'server' | 'other';

function categorizeGeminiError(error: any): GeminiErrorCategory {
  const status = error?.status ?? error?.response?.status;
  const message = String(error?.message || '').toLowerCase();

  if (
    status === 429 ||
    message.includes('quota') ||
    message.includes('resource_exhausted') ||
    message.includes('rate limit') ||
    message.includes('exceeded')
  ) {
    return 'quota';
  }
  if (
    status === 401 ||
    status === 403 ||
    message.includes('api_key_invalid') ||
    message.includes('api key not found') ||
    message.includes('permission_denied')
  ) {
    return 'auth';
  }
  if (
    (typeof status === 'number' && status >= 500 && status < 600) ||
    message.includes('service unavailable') ||
    message.includes('high demand') ||
    message.includes('overloaded') ||
    message.includes('try again later')
  ) {
    return 'server';
  }
  return 'other';
}

function isQuotaError(error: any): boolean {
  return categorizeGeminiError(error) === 'quota';
}

async function callGemini(opts: LLMCallOptions): Promise<string> {
  const modelName =
    opts.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: opts.systemPrompt,
    generationConfig: {
      temperature: opts.temperature ?? 0.5,
      maxOutputTokens: opts.maxTokens ?? 4096,
    },
  });
  const result = await model.generateContent(opts.userPrompt);
  return result.response.text() || '';
}

async function callGroq(opts: LLMCallOptions): Promise<string> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: opts.userPrompt });

  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    messages,
    temperature: opts.temperature ?? 0.5,
    max_tokens: opts.maxTokens ?? 4096,
  });
  return completion.choices[0]?.message?.content || '';
}

async function callOpenRouter(opts: LLMCallOptions): Promise<string> {
  if (!OPENROUTER_ENABLED) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: opts.userPrompt });

  // OpenRouter is OpenAI-compatible. HTTP-Referer + X-Title are optional but
  // help with attribution and free-tier rate limits per the OpenRouter docs.
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: OPENROUTER_MODEL,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 4096,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': (process.env.CLIENT_URL || '').split(',')[0].trim() || 'https://cognito-stream.vercel.app',
        'X-Title': 'Cognito Stream',
      },
      timeout: 60000,
    }
  );

  return response.data?.choices?.[0]?.message?.content || '';
}

/**
 * Generate text via the LLM cascade: OpenRouter (DeepSeek) → Gemini → Groq.
 * Each tier is skipped if it's in cooldown or unconfigured. Cooldowns are
 * triggered by quota/auth/5xx errors — other errors propagate.
 */
export async function callLLMText(opts: LLMCallOptions): Promise<string> {
  // Explicit provider override — bypasses cooldowns. Used by the code-gen
  // retry rotation so each attempt forces a different provider.
  if (opts.forceProvider === 'openrouter') {
    console.log('🧠 [OpenRouter] generating (forced)...');
    const text = await callOpenRouter(opts);
    console.log(`✅ [OpenRouter] returned ${text.length} chars`);
    return text;
  }
  if (opts.forceProvider === 'groq') {
    console.log('🧠 [Groq] generating (forced)...');
    const text = await callGroq(opts);
    console.log(`✅ [Groq] returned ${text.length} chars`);
    return text;
  }
  if (opts.forceProvider === 'gemini') {
    console.log('🧠 [Gemini] generating (forced)...');
    const text = await callGemini(opts);
    console.log(`✅ [Gemini] returned ${text.length} chars`);
    return text;
  }

  // Tier 1: OpenRouter (primary, DeepSeek by default)
  if (OPENROUTER_ENABLED && !isOpenRouterBlocked()) {
    try {
      console.log(`🧠 [OpenRouter:${OPENROUTER_MODEL}] generating...`);
      const text = await callOpenRouter(opts);
      console.log(`✅ [OpenRouter] returned ${text.length} chars`);
      return text;
    } catch (err) {
      // 402 = out of credits. Common, expected on the free tier — show the
      // status only, skip the noisy message. Anything else gets the full log.
      const status = (err as any)?.response?.status;
      if (status === 402) {
        blockOpenRouter('402 (out of credits)');
      } else {
        const message = String((err as Error)?.message || '').slice(0, 150);
        blockOpenRouter(`status=${status} ${message}`);
      }
    }
  } else if (!OPENROUTER_ENABLED) {
    // Skip silently — user hasn't configured OpenRouter.
  } else {
    console.log('⏭️  [OpenRouter] in cooldown — falling through to Gemini');
  }

  // Tier 2: Gemini
  if (!isGeminiBlocked()) {
    try {
      console.log('🧠 [Gemini] generating...');
      const text = await callGemini(opts);
      console.log(`✅ [Gemini] returned ${text.length} chars`);
      return text;
    } catch (err) {
      const category = categorizeGeminiError(err);
      if (category === 'quota' || category === 'auth' || category === 'server') {
        if (category === 'auth') {
          console.error('❌ Gemini API key issue — verify GEMINI_API_KEY_PRIMARY / GEMINI_API_KEY_SECONDARY in .env.');
        } else if (category === 'server') {
          console.warn('⚠️  Gemini upstream is overloaded (5xx) — switching to Groq.');
        }
        blockGemini(`${category}: ${String((err as Error).message || '').slice(0, 150)}`);
        // fall through to Groq
      } else {
        throw err;
      }
    }
  } else {
    console.log('⏭️  [Gemini] in cooldown — falling through to Groq');
  }

  // Tier 3: Groq (final fallback)
  console.log('🧠 [Groq] generating...');
  const text = await callGroq(opts);
  console.log(`✅ [Groq] returned ${text.length} chars`);
  return text;
}

/**
 * Probe each configured provider with a tiny prompt and report which work.
 * Used by /api/health/llm — does NOT touch the cooldown state.
 */
export async function pingLLMs(): Promise<{
  openrouter: { ok: boolean; latencyMs: number; sample?: string; error?: string; configured: boolean; model?: string };
  gemini: { ok: boolean; latencyMs: number; sample?: string; error?: string; quotaError?: boolean };
  groq: { ok: boolean; latencyMs: number; sample?: string; error?: string };
  fallback: {
    geminiInCooldown: boolean;
    openRouterInCooldown: boolean;
    cooldownExpiresAt: string | null;
  };
}> {
  const probe: LLMCallOptions = {
    systemPrompt: 'You are a test bot. Reply with one word.',
    userPrompt: 'Reply with the single word: OK',
    temperature: 0,
    maxTokens: 10,
  };

  // OpenRouter probe
  const orStart = Date.now();
  let openRouterResult: { ok: boolean; latencyMs: number; sample?: string; error?: string; configured: boolean; model?: string };
  if (!OPENROUTER_ENABLED) {
    openRouterResult = {
      ok: false,
      latencyMs: 0,
      configured: false,
      error: 'OPENROUTER_API_KEY not set',
    };
  } else {
    try {
      const text = await callOpenRouter(probe);
      openRouterResult = {
        ok: true,
        latencyMs: Date.now() - orStart,
        sample: text.trim().slice(0, 50),
        configured: true,
        model: OPENROUTER_MODEL,
      };
    } catch (err: any) {
      openRouterResult = {
        ok: false,
        latencyMs: Date.now() - orStart,
        configured: true,
        model: OPENROUTER_MODEL,
        error: String(err?.response?.data?.error?.message || err?.message || err).slice(0, 600),
      };
    }
  }

  // Gemini probe
  const geminiStart = Date.now();
  let geminiResult: { ok: boolean; latencyMs: number; sample?: string; error?: string; quotaError?: boolean };
  try {
    const text = await callGemini(probe);
    geminiResult = {
      ok: true,
      latencyMs: Date.now() - geminiStart,
      sample: text.trim().slice(0, 50),
    };
  } catch (err: any) {
    geminiResult = {
      ok: false,
      latencyMs: Date.now() - geminiStart,
      error: String(err?.message || err).slice(0, 600),
      quotaError: isQuotaError(err),
    };
  }

  // Groq probe
  const groqStart = Date.now();
  let groqResult: { ok: boolean; latencyMs: number; sample?: string; error?: string };
  try {
    const text = await callGroq(probe);
    groqResult = {
      ok: true,
      latencyMs: Date.now() - groqStart,
      sample: text.trim().slice(0, 50),
    };
  } catch (err: any) {
    groqResult = {
      ok: false,
      latencyMs: Date.now() - groqStart,
      error: String(err?.message || err).slice(0, 600),
    };
  }

  return {
    openrouter: openRouterResult,
    gemini: geminiResult,
    groq: groqResult,
    fallback: {
      geminiInCooldown: isGeminiBlocked(),
      openRouterInCooldown: isOpenRouterBlocked(),
      cooldownExpiresAt:
        geminiBlockedUntil > Date.now() ? new Date(geminiBlockedUntil).toISOString() : null,
    },
  };
}

// ==========================================
// MAIN FUNCTION
// ==========================================

export async function generateStoryboard(
  prompt: string,
  maxRetries: number = 3
): Promise<StoryboardResponse> {
  console.log('🤖 Generating storyboard with Gemini AI...');
  console.log(`📝 Prompt: "${prompt.substring(0, 100)}..."`);

  // SculptAI-style storyboard prompt: asks for raw JSON array with scene_title/narration/visual_description
  const promptForStoryboard = `
You are an expert instructional designer and scriptwriter.
Your task is to take the user's idea and generate a detailed, step-by-step explanatory script.
This script should be broken down into logical scenes. For each scene, provide:
1. A short "scene_title".
2. The "narration" script for that scene.
3. A brief "visual_description" of what should be animated or shown.
Focus on a logical flow that builds understanding.
Output MUST be a valid JSON array of objects, where each object represents a scene and has keys: "scene_title", "narration", "visual_description".
Do not include any text outside of this JSON array, no markdown formatting (like \`\`\`json), just the raw JSON array itself.

User Idea: "${prompt}"

JSON Storyboard Output:
  `;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries}`);

      const responseText = (await callLLMText({
        userPrompt: promptForStoryboard,
        temperature: 0.5,
        maxTokens: 4096,
      })).trim();

      if (!responseText) {
        throw new Error('Empty response from LLM');
      }

      console.log('📄 Raw LLM response:', responseText.substring(0, 200));

      // Parse JSON — handle both raw JSON and markdown-fenced JSON
      let parsedStoryboard: any;
      try {
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
        parsedStoryboard = jsonMatch && jsonMatch[1] ? JSON.parse(jsonMatch[1]) : JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ JSON parse error:', parseError);
        throw new Error('Failed to parse storyboard JSON from LLM. Ensure valid JSON output.');
      }

      // Handle various response shapes (array, or object with .storyboard/.scenes)
      const scenesArray = parsedStoryboard.storyboard || parsedStoryboard.scenes || parsedStoryboard;

      if (!Array.isArray(scenesArray) || scenesArray.length === 0) {
        throw new Error('LLM did not return a valid storyboard array.');
      }

      // Map SculptAI scene format to Cognito-Stream format
      const storyboard: StoryboardResponse = {
        title: prompt.substring(0, 80),
        description: `Educational animation about: ${prompt}`,
        scenes: scenesArray.map((scene: any, index: number) => ({
          id: `scene-${index + 1}`,
          narration: scene.narration || '',
          visualDescription: scene.visual_description || scene.visualDescription || '',
          manimOperations: [], // Will be generated separately via generateManimSceneCode
          estimatedDuration: 5,
        })),
      };

      // Validate the mapped response
      validateStoryboard(storyboard);

      console.log(`✅ Generated ${storyboard.scenes.length} scenes`);
      console.log(`📊 Title: "${storyboard.title}"`);

      return storyboard;

    } catch (error) {
      lastError = error as Error;
      console.error(`❌ Attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to generate storyboard after ${maxRetries} attempts: ${lastError?.message}`
  );
}

// ==========================================
// VALIDATION
// ==========================================

function validateStoryboard(storyboard: any): void {
  if (!storyboard || typeof storyboard !== 'object') {
    throw new Error('Invalid storyboard: not an object');
  }

  if (!storyboard.title || typeof storyboard.title !== 'string') {
    throw new Error('Invalid storyboard: missing or invalid title');
  }

  if (!storyboard.description || typeof storyboard.description !== 'string') {
    throw new Error('Invalid storyboard: missing or invalid description');
  }

  if (!Array.isArray(storyboard.scenes)) {
    throw new Error('Invalid storyboard: scenes must be an array');
  }

  if (storyboard.scenes.length === 0) {
    throw new Error('Invalid storyboard: no scenes generated');
  }

  if (storyboard.scenes.length > 20) {
    throw new Error('Invalid storyboard: too many scenes (max 20)');
  }

  // Validate each scene
  storyboard.scenes.forEach((scene: any, index: number) => {
    if (!scene.id || typeof scene.id !== 'string') {
      throw new Error(`Scene ${index}: missing or invalid id`);
    }

    if (!scene.narration || typeof scene.narration !== 'string') {
      throw new Error(`Scene ${index}: missing or invalid narration`);
    }

    if (scene.narration.length > 1000) {
      throw new Error(`Scene ${index}: narration too long (max 1000 chars)`);
    }

    if (!scene.visualDescription || typeof scene.visualDescription !== 'string') {
      throw new Error(`Scene ${index}: missing or invalid visualDescription`);
    }

    if (
      typeof scene.estimatedDuration !== 'number' ||
      scene.estimatedDuration <= 0
    ) {
      throw new Error(`Scene ${index}: invalid estimatedDuration`);
    }

    if (scene.estimatedDuration > 15) {
      console.warn(`Scene ${index}: duration ${scene.estimatedDuration}s is quite long`);
    }
  });

  console.log('✅ Storyboard validation passed');
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Generate a storyboard with custom configuration
 */
export async function generateStoryboardWithConfig(
  prompt: string,
  config: {
    temperature?: number;
    maxScenes?: number;
    minDuration?: number;
    maxDuration?: number;
  } = {}
): Promise<StoryboardResponse> {
  const customPrompt = `
${prompt}

Additional requirements:
${config.maxScenes ? `- Create no more than ${config.maxScenes} scenes` : ''}
${config.minDuration ? `- Each scene should be at least ${config.minDuration} seconds` : ''}
${config.maxDuration ? `- Each scene should be no more than ${config.maxDuration} seconds` : ''}
  `.trim();

  return generateStoryboard(customPrompt);
}

/**
 * Regenerate a single scene with different parameters
 */
export async function regenerateScene(
  scenePrompt: string,
  sceneNumber: number
): Promise<StoryboardScene> {
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.8,
    },
  });

  const prompt = `Generate a single scene for an educational video.

Scene requirements:
- Scene number: ${sceneNumber}
- Content: ${scenePrompt}
- Include narration (50-150 words)
- Include visual description
- Include valid Manim operations
- Duration: 3-7 seconds

Return as JSON with this structure:
{
  "id": "scene-${sceneNumber}",
  "narration": "...",
  "visualDescription": "...",
  "manimOperations": ["..."],
  "estimatedDuration": 5
}`;

  const result = await model.generateContent(prompt);
  const scene = JSON.parse(result.response.text());

  return scene;
}

// ==========================================
// MANIM CODE GENERATION (Full Python Code)
// ==========================================

/**
 * Generate a complete Manim Python scene class for a single scene.
 * Returns the raw Python code string.
 */
export async function generateManimSceneCode(
  params: SceneCodeGenParams,
  maxRetries: number = 3
): Promise<string> {
  console.log(`🎨 Generating Manim code for scene ${params.sceneNumber}: "${params.sceneTitle}"`);

  let lastError: Error | null = null;
  // Rotate providers across retries for maximum diversity. A model that
  // keeps emitting the same broken pattern gets bypassed automatically.
  // Default rotation: OpenRouter (DeepSeek) → Gemini → Groq.
  // Skips OpenRouter if it's not configured.
  const fullRotation: ('openrouter' | 'gemini' | 'groq')[] = OPENROUTER_ENABLED
    ? ['openrouter', 'gemini', 'groq']
    : ['gemini', 'groq'];
  const envOverride = process.env.LLM_CODE_PROVIDER as 'openrouter' | 'gemini' | 'groq' | undefined;
  // If the user pinned a primary, put it first and follow with the rest.
  const rotation: ('openrouter' | 'gemini' | 'groq')[] = envOverride
    ? [envOverride, ...fullRotation.filter((p) => p !== envOverride)]
    : fullRotation;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const provider = rotation[(attempt - 1) % rotation.length];
      console.log(`🔄 Code generation attempt ${attempt}/${maxRetries} via ${provider}`);

      let code = await callLLMText({
        systemPrompt: MANIM_CODE_SYSTEM_PROMPT,
        userPrompt: buildCodeGenPrompt(params),
        // Bump temperature on retries to break out of stuck output patterns.
        temperature: attempt === 1 ? 0.4 : 0.6,
        maxTokens: 4096,
        geminiModel: process.env.GEMINI_CODE_MODEL || 'gemini-2.5-flash',
        forceProvider: provider,
      });

      if (!code || code.trim().length === 0) {
        throw new Error('Empty code response from LLM');
      }

      // Strip markdown fences if present
      code = stripMarkdownFences(code);
      // Patch wrong class names ("class FooScene(Scene):" → "class GeneratedScene(Scene):")
      code = normalizeSceneClassName(code);

      // Sanity check — a real Manim scene class is several hundred chars at
      // minimum. If we got back something tiny (e.g. just ")" or a refusal
      // string), skip validateManimCode so we don't surface the misleading
      // "missing class GeneratedScene" cascade. Bail with a clearer error
      // that includes a preview of what actually came back.
      const trimmed = code.trim();
      if (trimmed.length < 200) {
        throw new Error(
          `LLM returned truncated output (${trimmed.length} chars): ${JSON.stringify(trimmed.slice(0, 120))}`
        );
      }

      // Pre-render validation — catch known-bad patterns BEFORE shipping to the
      // renderer. Each finding throws into the existing retry loop, saving a
      // 60-90s Manim round-trip per bad attempt.
      const issues = validateManimCode(code);
      if (issues.length > 0) {
        // Include a head + tail preview so we can see what the LLM actually
        // returned when it skips the required structure. Useful for telling
        // "the model returned prose" from "the model returned JSON" etc.
        const preview =
          code.length <= 240
            ? code
            : `${code.slice(0, 160)} … ${code.slice(-80)}`;
        throw new Error(
          `Pre-render validation failed: ${issues.join('; ')} | preview: ${JSON.stringify(preview)}`
        );
      }

      console.log(`✅ Manim code generated (${code.length} chars)`);
      return code;
    } catch (error) {
      lastError = error as Error;
      // Log message only — stack traces from validation failures are noise.
      console.error(`❌ Code generation attempt ${attempt} failed: ${(error as Error).message}`);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to generate Manim code after ${maxRetries} attempts: ${lastError?.message}`
  );
}

/**
 * Attempt to correct failing Manim code using Gemini.
 * Returns the corrected Python code string.
 */
export async function correctManimCode(
  params: CodeCorrectionParams
): Promise<string> {
  // Rotate providers on each correction attempt so we don't keep asking
  // the same model (which already produced bad code) to fix itself. We start
  // the rotation AT POSITION 1 (skipping the original primary that just
  // failed) and cycle through the rest.
  const fullRotation: ('openrouter' | 'gemini' | 'groq')[] = OPENROUTER_ENABLED
    ? ['openrouter', 'gemini', 'groq']
    : ['gemini', 'groq'];
  const envOverride = process.env.LLM_CODE_PROVIDER as 'openrouter' | 'gemini' | 'groq' | undefined;
  const rotation: ('openrouter' | 'gemini' | 'groq')[] = envOverride
    ? [envOverride, ...fullRotation.filter((p) => p !== envOverride)]
    : fullRotation;
  // attemptNumber is 1-indexed; pick the (attemptNumber)th slot which skips
  // the original primary at index 0.
  const provider = rotation[params.attemptNumber % rotation.length];

  console.log(`🔧 Correcting Manim code (attempt ${params.attemptNumber}) via ${provider}...`);

  // Compose the correction system prompt: include the FULL code-gen guidance so the
  // model retains version constraints, allowed APIs, and few-shot patterns; then
  // append the error-recovery-specific rules.
  const compositeSystemPrompt = `${MANIM_CODE_SYSTEM_PROMPT}

---

ADDITIONAL ERROR RECOVERY RULES (the previous attempt failed — fix it):

${CODE_CORRECTION_SYSTEM_PROMPT}`;

  let code = await callLLMText({
    systemPrompt: compositeSystemPrompt,
    userPrompt: buildCodeCorrectionPrompt(params),
    // Slightly higher temp on later corrections to escape the stuck pattern.
    temperature: params.attemptNumber === 1 ? 0.2 : 0.4,
    maxTokens: 4096,
    geminiModel: process.env.GEMINI_CODE_MODEL || 'gemini-2.5-flash',
    forceProvider: provider,
  });

  if (!code || code.trim().length === 0) {
    throw new Error('Empty correction response from LLM');
  }

  // Strip markdown fences if present
  code = stripMarkdownFences(code);
  // Patch wrong class names — same self-heal as the initial generation path.
  code = normalizeSceneClassName(code);

  if (!code.includes('class GeneratedScene')) {
    throw new Error('Corrected code missing GeneratedScene class');
  }

  console.log(`✅ Code corrected (${code.length} chars)`);
  return code;
}

/**
 * Static validation of generated Manim code. Returns a list of issues; empty
 * list means the code passes. Catches the common LLM mistakes that would
 * otherwise burn a full render cycle to surface.
 */
function validateManimCode(code: string): string[] {
  const issues: string[] = [];

  // Structural requirements
  if (!code.includes('class GeneratedScene')) {
    issues.push("missing 'class GeneratedScene'");
  }
  if (!code.includes('def construct')) {
    issues.push("missing 'def construct' method");
  }
  if (!/from\s+manim\s+import/.test(code)) {
    issues.push("missing 'from manim import ...'");
  }

  // Forbidden import paths (frequent LLM hallucinations)
  if (/from\s+manim\.constants\s+import/.test(code)) {
    issues.push("uses 'from manim.constants import ...' (use 'from manim import ...')");
  }
  if (/from\s+manim\.animation\.rate_functions\s+import/.test(code)) {
    issues.push(
      "uses 'manim.animation.rate_functions' (correct path: 'manim.utils.rate_functions')"
    );
  }

  // Non-existent methods we've seen the LLM invent
  if (/\.get_lines\s*\(/.test(code)) {
    issues.push("'.get_lines()' is not a real Manim method — build Line() objects between vertices instead");
  }
  if (/\bCENTER\b(?!\s*=)/.test(code)) {
    issues.push("'CENTER' is not exported by Manim — use 'ORIGIN'");
  }

  // HTML leakage in strings (Pango/Manim won't render these)
  if (/Text\([^)]*<\/?\w+>/.test(code) || /MathTex\([^)]*<\/?\w+>/.test(code)) {
    issues.push('HTML tag found inside a Text/MathTex string — strip it');
  }

  // Truncation / unbalanced braces (rough heuristic)
  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (Math.abs(openParens - closeParens) > 2) {
    issues.push(
      `unbalanced parentheses (${openParens} '(' vs ${closeParens} ')') — code may be truncated`
    );
  }

  return issues;
}

/**
 * Strip markdown code fences from LLM output.
 */
function stripMarkdownFences(code: string): string {
  // Remove ```python ... ``` wrapping
  code = code.replace(/^```(?:python)?\s*\n?/i, '');
  code = code.replace(/\n?```\s*$/i, '');
  return code.trim();
}

/**
 * Auto-rename any Scene subclass to `GeneratedScene` so the renderer's loader
 * always finds the expected class. The LLM occasionally invents its own name
 * (e.g. `class MyScene(Scene):`) even though the prompt is explicit — instead
 * of burning a retry on that, we just patch it. The parent class is preserved,
 * so `MovingCameraScene`, `ThreeDScene`, etc. still work.
 */
function normalizeSceneClassName(code: string): string {
  return code.replace(
    /class\s+(\w+)\s*\(\s*([A-Z]\w*Scene)\s*\)\s*:/g,
    (full, name: string, parent: string) =>
      name === 'GeneratedScene' ? full : `class GeneratedScene(${parent}):`
  );
}

// ==========================================
// EXPORT
// ==========================================

export default {
  generateStoryboard,
  generateStoryboardWithConfig,
  regenerateScene,
  generateManimSceneCode,
  correctManimCode,
};