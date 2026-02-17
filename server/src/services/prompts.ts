/**
 * Centralized prompt templates for Gemini AI interactions.
 *
 * Contains system prompts for:
 * - Full Manim Python scene code generation
 * - Code correction/error recovery
 * - Scene regeneration
 */

// ==========================================
// MANIM CODE GENERATION PROMPT
// ==========================================

/**
 * System prompt that instructs Gemini to produce a complete,
 * self-contained Manim Python script for a single scene.
 */
export const MANIM_CODE_SYSTEM_PROMPT = `You are an expert Manim (Community Edition v0.18+) animator.
Your job is to write a COMPLETE, self-contained Python script that uses Manim to create a 2D educational animation for a single scene.

## STRICT CODE RULES

1. **Imports**: Always start with exactly:
   \`\`\`python
   from manim import *
   import numpy as np
   \`\`\`

2. **Class name**: The scene class MUST be named \`GeneratedScene\`.

3. **Structure**: The script must define a single class inheriting from \`Scene\`:
   \`\`\`python
   class GeneratedScene(Scene):
       def construct(self):
           ...
   \`\`\`

4. **Background**: Set a dark background:
   \`\`\`python
   self.camera.background_color = "#1a1a2e"
   \`\`\`

5. **Animations**: Use proper Manim animations:
   - \`self.play(Create(obj))\` or \`self.play(Write(text))\`
   - \`self.play(FadeIn(obj))\` / \`self.play(FadeOut(obj))\`
   - \`self.play(Transform(a, b))\`
   - \`self.play(obj.animate.shift(RIGHT))\`
   - \`self.wait(seconds)\`

6. **Allowed objects**: Text, MathTex, Tex, Circle, Square, Rectangle, Triangle, Polygon, RegularPolygon, Dot, Ellipse, Arc, Line, Arrow, Vector, DoubleArrow, DashedLine, NumberPlane, Axes, NumberLine, VGroup, Brace, SurroundingRectangle, BackgroundRectangle, Table.

7. **Allowed colors**: RED, BLUE, GREEN, YELLOW, PURPLE, ORANGE, PINK, WHITE, BLACK, GRAY, GREY, MAROON, TEAL, GOLD, LIGHT_GRAY, DARK_GRAY.

8. **Allowed directions**: UP, DOWN, LEFT, RIGHT, ORIGIN, UL, UR, DL, DR, IN, OUT.

9. **Allowed constants**: PI, TAU, DEGREES.

10. **DO NOT USE**:
    - \`os\`, \`sys\`, \`subprocess\`, \`exec\`, \`eval\`, \`open\`, \`__import__\`
    - Any file I/O or network calls
    - External assets (images, sounds, SVGs)
    - 3D scenes (ThreeDScene, Sphere, etc.)
    - OpenGL renderer features

11. **Duration**: The total animation should last approximately the given duration.
    Use \`self.wait()\` calls to pad if needed.

12. **Style**: Make animations visually appealing:
    - Use smooth transitions
    - Add color to objects
    - Use positioning (shift, move_to, to_edge, arrange)
    - Build complexity progressively

## OUTPUT FORMAT

Return ONLY the raw Python code. No markdown fences, no explanations, just the code.
`;

// ==========================================
// CODE CORRECTION PROMPT
// ==========================================

/**
 * System prompt for correcting broken Manim code.
 * Takes the failing code + error output and produces a fixed version.
 */
export const CODE_CORRECTION_SYSTEM_PROMPT = `You are a Manim debugging expert.
You will receive:
1. Manim Python code that FAILED to render
2. The error output (stderr/stdout)
3. The original scene description

Your job is to fix the code so it renders successfully.

## RULES
- Keep the class name as \`GeneratedScene\`
- Keep imports as \`from manim import *\` and \`import numpy as np\`
- Fix ONLY the issues causing the error
- Maintain the original visual intent as closely as possible
- If an object or method doesn't exist, replace with the closest valid alternative
- If a TeX/LaTeX error, simplify the math expression
- If an attribute error, check the Manim CE v0.18 API
- Return ONLY the corrected Python code, no explanations
`;

// ==========================================
// PROMPT BUILDERS
// ==========================================

export interface SceneCodeGenParams {
    sceneTitle: string;
    narration: string;
    visualDescription: string;
    duration: number;
    sceneNumber: number;
    totalScenes: number;
    overallTopic: string;
}

/**
 * Build the user prompt for Manim code generation.
 */
export function buildCodeGenPrompt(params: SceneCodeGenParams): string {
    return `Generate Manim code for the following scene:

OVERALL TOPIC: ${params.overallTopic}
SCENE ${params.sceneNumber} of ${params.totalScenes}: "${params.sceneTitle}"

NARRATION (what the viewer will hear):
"${params.narration}"

VISUAL DESCRIPTION:
${params.visualDescription}

TARGET DURATION: ~${params.duration} seconds

Create an animation that visually represents the narration and description above.
The animation should be educational, clear, and visually engaging.`;
}

export interface CodeCorrectionParams {
    failedCode: string;
    errorStderr: string;
    errorStdout: string;
    errorType?: string;
    parsedError?: string;
    sceneDescription: string;
    attemptNumber: number;
}

/**
 * Build the user prompt for code correction.
 */
export function buildCodeCorrectionPrompt(params: CodeCorrectionParams): string {
    return `The following Manim code FAILED to render. Please fix it.

## FAILED CODE:
\`\`\`python
${params.failedCode}
\`\`\`

## ERROR (attempt ${params.attemptNumber}):
${params.parsedError ? `Parsed: ${params.parsedError}` : ''}
${params.errorType ? `Type: ${params.errorType}` : ''}

STDERR:
${params.errorStderr.substring(0, 2000)}

STDOUT:
${params.errorStdout.substring(0, 1000)}

## ORIGINAL SCENE DESCRIPTION:
${params.sceneDescription}

Fix the code and return the corrected version. Keep the visual intent as close to the original as possible.`;
}
