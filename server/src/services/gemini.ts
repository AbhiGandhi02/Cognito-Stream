import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });

// ==========================================
// LLM FALLBACK (Gemini → Groq)
// ==========================================

interface LLMCallOptions {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  // Override the Gemini model for a single call (e.g. 'gemini-2.5-pro' for code).
  // Falls back to GEMINI_MODEL env, then 'gemini-2.5-flash'.
  geminiModel?: string;
}

// Module-local cooldown: when Gemini reports quota exhausted we skip it for
// 30 minutes and route to Groq. Resets on server restart.
const GEMINI_COOLDOWN_MS = 30 * 60 * 1000;
let geminiBlockedUntil = 0;

function isGeminiBlocked(): boolean {
  return Date.now() < geminiBlockedUntil;
}

function blockGemini(reason: string): void {
  geminiBlockedUntil = Date.now() + GEMINI_COOLDOWN_MS;
  const minutes = Math.round(GEMINI_COOLDOWN_MS / 60000);
  console.warn(`⚠️  Gemini cooldown for ${minutes}min — falling back to Groq. (${reason})`);
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

/**
 * Generate text via Gemini, falling back to Groq when Gemini is over quota.
 */
export async function callLLMText(opts: LLMCallOptions): Promise<string> {
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
          console.error('❌ Gemini API key issue — verify GEMINI_API_KEY in .env.');
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
    console.log('⏭️  [Gemini] in cooldown — using Groq');
  }

  console.log('🧠 [Groq] generating...');
  const text = await callGroq(opts);
  console.log(`✅ [Groq] returned ${text.length} chars`);
  return text;
}

/**
 * Probe both providers with a tiny prompt and report which one(s) work.
 * Used by /api/health/llm — does NOT touch the cooldown state.
 */
export async function pingLLMs(): Promise<{
  gemini: { ok: boolean; latencyMs: number; sample?: string; error?: string; quotaError?: boolean };
  groq: { ok: boolean; latencyMs: number; sample?: string; error?: string };
  fallback: { geminiInCooldown: boolean; cooldownExpiresAt: string | null };
}> {
  const probe: LLMCallOptions = {
    systemPrompt: 'You are a test bot. Reply with one word.',
    userPrompt: 'Reply with the single word: OK',
    temperature: 0,
    maxTokens: 10,
  };

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
    gemini: geminiResult,
    groq: groqResult,
    fallback: {
      geminiInCooldown: isGeminiBlocked(),
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
  maxRetries: number = 2
): Promise<string> {
  console.log(`🎨 Generating Manim code for scene ${params.sceneNumber}: "${params.sceneTitle}"`);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Code generation attempt ${attempt}/${maxRetries}`);

      let code = await callLLMText({
        systemPrompt: MANIM_CODE_SYSTEM_PROMPT,
        userPrompt: buildCodeGenPrompt(params),
        temperature: 0.4,
        maxTokens: 4096,
        geminiModel: process.env.GEMINI_CODE_MODEL || 'gemini-2.5-pro',
      });

      if (!code || code.trim().length === 0) {
        throw new Error('Empty code response from LLM');
      }

      // Strip markdown fences if present
      code = stripMarkdownFences(code);

      // Pre-render validation — catch known-bad patterns BEFORE shipping to the
      // renderer. Each finding throws into the existing retry loop, saving a
      // 60-90s Manim round-trip per bad attempt.
      const issues = validateManimCode(code);
      if (issues.length > 0) {
        throw new Error(`Pre-render validation failed: ${issues.join('; ')}`);
      }

      console.log(`✅ Manim code generated (${code.length} chars)`);
      return code;
    } catch (error) {
      lastError = error as Error;
      console.error(`❌ Code generation attempt ${attempt} failed:`, error);

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
  console.log(`🔧 Correcting Manim code (attempt ${params.attemptNumber})...`);

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
    temperature: 0.2,
    maxTokens: 4096,
    geminiModel: process.env.GEMINI_CODE_MODEL || 'gemini-2.5-pro',
  });

  if (!code || code.trim().length === 0) {
    throw new Error('Empty correction response from LLM');
  }

  // Strip markdown fences if present
  code = stripMarkdownFences(code);

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