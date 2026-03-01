import { GoogleGenerativeAI } from '@google/generative-ai';
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

const SYSTEM_PROMPT = `You are an expert educational video script writer and Manim animator.

Your task is to convert user prompts into detailed, structured storyboards for animated educational videos.

IMPORTANT GUIDELINES:

1. **Scene Structure**: Create 3-8 scenes for a complete educational video
2. **Narration**: Write clear, engaging narration (50-150 words per scene)
3. **Visual Description**: Describe what viewers will see
4. **Manim Operations**: Provide valid Python Manim code snippets

MANIM CODE REQUIREMENTS:
- Use ONLY these safe, whitelisted operations:
  * Text objects: Text("content").scale(size)
  * Math: MathTex("equation").scale(size)
  * Shapes: Circle(), Square(), Rectangle(), Triangle(), Dot()
  * Lines: Line(start, end), Arrow(start, end)
  * Groups: VGroup(obj1, obj2).arrange(direction)
  * Colors: RED, BLUE, GREEN, YELLOW, PURPLE, ORANGE, WHITE
  * Positioning: .shift(LEFT), .shift(RIGHT*2), .move_to(ORIGIN)
  * Styling: .set_fill(color, opacity), .set_stroke(color, width)

- Each operation should be a complete, valid Manim object creation
- Keep operations simple and executable
- Avoid complex animations or transformations
- Focus on creating clear, educational visuals

DURATION GUIDELINES:
- Keep scenes between 3-7 seconds each
- Match duration to narration length
- Allow time for viewers to absorb visuals

EDUCATIONAL FOCUS:
- Break complex topics into digestible chunks
- Use analogies and examples
- Build concepts progressively
- Include visual reinforcement

Example Manim operations:
- "Text('Welcome to Physics').scale(1.5).shift(UP)"
- "MathTex('E = mc^2').scale(2)"
- "Circle().set_fill(BLUE, opacity=0.5).shift(LEFT)"
- "VGroup(Text('Input'), Arrow(LEFT, RIGHT), Text('Output')).arrange(RIGHT)"`;

// ==========================================
// RESPONSE SCHEMA
// ==========================================

const responseSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Engaging title for the educational video',
    },
    description: {
      type: 'string',
      description: 'Brief description of what the video covers',
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique identifier (use scene-1, scene-2, etc.)',
          },
          narration: {
            type: 'string',
            description: 'What will be spoken in this scene',
          },
          visualDescription: {
            type: 'string',
            description: 'Description of visual elements',
          },
          manimOperations: {
            type: 'array',
            items: {
              type: 'string',
              description: 'Valid Manim Python code snippet',
            },
            description: 'Array of Manim code operations',
          },
          estimatedDuration: {
            type: 'number',
            description: 'Duration in seconds (3-7 seconds)',
          },
        },
        required: [
          'id',
          'narration',
          'visualDescription',
          'manimOperations',
          'estimatedDuration',
        ],
      },
    },
  },
  required: ['title', 'description', 'scenes'],
};

// ==========================================
// MAIN FUNCTION
// ==========================================

export async function generateStoryboard(
  prompt: string,
  maxRetries: number = 3
): Promise<StoryboardResponse> {
  console.log('🤖 Generating storyboard with Gemini AI...');
  console.log(`📝 Prompt: "${prompt.substring(0, 100)}..."`);

  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema as any,
      temperature: 0.7,
      maxOutputTokens: 8192, // Increased to prevent truncation
    },
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries}`);

      const result = await model.generateContent([
        { text: SYSTEM_PROMPT },
        { text: `Create a detailed storyboard for: "${prompt}"` },
      ]);

      const response = result.response.text();

      if (!response) {
        throw new Error('Empty response from Gemini');
      }

      const storyboard = JSON.parse(response) as StoryboardResponse;

      // Validate the response
      validateStoryboard(storyboard);

      console.log(`✅ Generated ${storyboard.scenes.length} scenes`);
      console.log(`📊 Title: "${storyboard.title}"`);

      return storyboard;

    } catch (error) {
      lastError = error as Error;
      console.error(`❌ Attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
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

    if (!Array.isArray(scene.manimOperations)) {
      throw new Error(`Scene ${index}: manimOperations must be an array`);
    }

    if (scene.manimOperations.length === 0) {
      throw new Error(`Scene ${index}: no Manim operations provided`);
    }

    // Validate each Manim operation
    scene.manimOperations.forEach((op: any, opIndex: number) => {
      if (typeof op !== 'string') {
        throw new Error(
          `Scene ${index}, Operation ${opIndex}: must be a string`
        );
      }

      // Basic safety check - ensure no dangerous operations
      const dangerousPatterns = [
        'import',
        'exec',
        'eval',
        'open(',
        'file',
        '__',
        'system',
        'subprocess',
        'os.',
      ];

      const lowerOp = op.toLowerCase();
      for (const pattern of dangerousPatterns) {
        if (lowerOp.includes(pattern)) {
          throw new Error(
            `Scene ${index}, Operation ${opIndex}: contains dangerous pattern "${pattern}"`
          );
        }
      }
    });

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

  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.4, // Lower temp for more reliable code
      maxOutputTokens: 4096,
    },
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Code generation attempt ${attempt}/${maxRetries}`);

      const result = await model.generateContent([
        { text: MANIM_CODE_SYSTEM_PROMPT },
        { text: buildCodeGenPrompt(params) },
      ]);

      let code = result.response.text();

      if (!code || code.trim().length === 0) {
        throw new Error('Empty code response from Gemini');
      }

      // Strip markdown fences if present
      code = stripMarkdownFences(code);

      // Basic validation
      if (!code.includes('class GeneratedScene')) {
        throw new Error('Generated code missing GeneratedScene class');
      }
      if (!code.includes('def construct')) {
        throw new Error('Generated code missing construct method');
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

  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.2, // Very low temp for precise fixes
      maxOutputTokens: 4096,
    },
  });

  const result = await model.generateContent([
    { text: CODE_CORRECTION_SYSTEM_PROMPT },
    { text: buildCodeCorrectionPrompt(params) },
  ]);

  let code = result.response.text();

  if (!code || code.trim().length === 0) {
    throw new Error('Empty correction response from Gemini');
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