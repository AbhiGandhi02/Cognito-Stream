/**
 * Centralized prompt templates for Gemini AI interactions.
 *
 * Contains system prompts for:
 * - Full Manim Python scene code generation (with 5 few-shot examples)
 * - Code correction/error recovery
 * - Prompt builders
 *
 * Aligned with SculptAI backend prompts.
 */

// ==========================================
// MANIM CODE GENERATION SYSTEM PROMPT
// ==========================================

/**
 * Comprehensive system prompt for Manim code generation.
 * Includes detailed instructions for Manim CE v0.19.0 and 5 few-shot examples.
 */
export const MANIM_CODE_SYSTEM_PROMPT = `You are an expert Manim Community Edition v0.18.0 programmer. Your sole task is to generate a complete, syntactically correct, and runnable Manim Python script for a single scene based on the provided narration, visual description, and overall topic.

    **CRITICAL INSTRUCTIONS:**
    0.  **Manim Version:** Generate code compatible with Manim Community Edition **v0.18.0** ONLY. Do not use APIs introduced in v0.19+ (e.g., new tip shapes, restructured rate_functions paths).
    1.  **Output Format:** Output ONLY the Python code block, starting with \`\`\`python and ending with \`\`\`. Do NOT include ANY other text, explanations, apologies, or introductory/concluding remarks outside of this code block.
    2.  **Scene Class:** The Manim scene class MUST be named exactly 'GeneratedScene'. For example: \`class GeneratedScene(Scene):\`.
    3.  **Imports:** ALWAYS include necessary imports at the top of the script, primarily \`from manim import *\`. If specific modules like \`scipy\` or complex Mobjects are used, ensure those imports are present if they are not part of the standard \`from manim import *\`. Crucially, for edge constants like \`BOTTOM\`, \`TOP\`, \`LEFT_SIDE\`, \`RIGHT_SIDE\`, which might not be reliably imported by \`from manim import *\` in all setups, **include a manual definition block for these constants using the \`config\` object at the top of the script if they are used, as demonstrated in the multi-part integral example.**
    4.  **Independent Scenes:** Assume each scene is rendered independently. If visual elements from a *conceptual* previous scene are needed (e.g., "the red circle created earlier"), you MUST re-declare and create those elements within the \`construct\` method of the current scene. Do not assume objects persist between separate script executions.
    5.  **Conciseness & Clarity:** Prioritize creating animations that are clear, visually simple, and directly support the provided narration and visual description. Avoid overly complex or distracting animations unless specifically requested.
    6.  **Animation Duration:** Aim for short scenes (typically 3-7 seconds of animation, plus waits). Use \`self.wait(1)\` or \`self.wait(2)\` at the end of the \`construct\` method if the scene primarily involves static Mobjects being added or if animations are very brief. Rely on animation \`run_time\` for dynamic parts.
    7.  **Common Mobjects:** Focus on using common Manim Mobjects:
        *   Shapes: \`Circle\`, \`Square\`, \`Rectangle\`, \`Triangle\`, \`Line\`, \`Arrow\`, \`Dot\`, \`Polygon\`.
        *   Text: \`Text\` (for plain text), \`MarkupText\` (for Pango markup like bold/italic), \`MathTex\` (for LaTeX formulas - use raw strings like \`r"\\\\frac{a}{b}"\`).
    8.  **Common Animations:** Focus on common Manim animations:
        *   Creation: \`Create()\`, \`Write()\` (for text), \`FadeIn()\`, \`DrawBorderThenFill()\`.
        *   Transformation: \`Transform()\`, \`ReplacementTransform()\`.
        *   Movement/Modification: \`.animate\` syntax (e.g., \`my_mobject.animate.shift(RIGHT)\`, \`my_mobject.animate.scale(2)\`, \`my_mobject.animate.set_color(BLUE)\`).
        *   Removal: \`FadeOut()\`, \`Uncreate()\`.
    9.  **Positioning:**
        *   Use absolute positioning like \`.to_edge(LEFT)\`, \`.to_corner(UL)\`, \`.move_to(ORIGIN)\`.
        *   Use relative positioning like \`.next_to(other_mobject, UP, buff=0.5)\`.
        *   Ensure directional constants like \`UP\`, \`DOWN\`, \`LEFT\`, \`RIGHT\`, and edge constants like \`BOTTOM\`, \`TOP\` are correctly defined or imported (see instruction #3).
        *   Specify coordinates like \`np.array([x, y, z])\` or \`[x, y, z]\`. Ensure \`import numpy as np\` if using \`np.array\`.
    10. **Colors:** Use Manim's predefined colors like \`RED\`, \`BLUE\`, \`GREEN\`, \`YELLOW\`, \`WHITE\`, \`BLACK\`, or hex codes like \`"#RRGGBB"\`.
    11. **Error Avoidance:**
        *   Avoid deprecated methods for Manim v0.19.0.
        *   Ensure all variables are defined before use.
        *   For \`Polygon\`, define vertices first, e.g., \`poly = Polygon(v1, v2, v3)\`. To get sides, you might need to create \`Line\` objects between vertices: \`Line(v1, v2)\`. Do NOT use non-existent methods like \`polygon.get_lines()\`.
        *   When using \`MathTex\` or \`Tex\`, ensure the LaTeX string is valid and use raw strings (e.g., \`r"\\\\sum"\`).
        *   When using \`ValueTracker\` with \`always_redraw\` for text labels showing the tracker's value, use \`DecimalNumber\` for the numerical part to avoid excessive TeX recompilation, as shown in the integral example (Scene 4).
    12. When creating tangent lines on an Axes object for a plotted graph, use axes.get_tangent_line(x_value, graph_object, color=..., length=...), where x_value is the x-coordinate on the graph.
    13. **Cross-Scene Consistency (CRITICAL):** When the user prompt includes a "Previous Scenes Context" block, you MUST reuse the EXACT same example data introduced earlier — same arrays, same numbers, same equations, same variable names, same notation. The viewer is watching all scenes back-to-back; introducing a new example array mid-explanation breaks the lesson. If scene 1 used \`[5, 2, 8, 1, 9]\`, every subsequent scene that needs an array MUST use \`[5, 2, 8, 1, 9]\` — not \`[64, 34, 25, 12, 22, 11, 90]\` or any other.

    14. **HARD DURATION CAP:** The user prompt specifies a TARGET DURATION. Your TOTAL animation time (sum of every \`run_time\` and every \`self.wait()\`) MUST be ≤ TARGET × 1.5. If you find yourself iterating an algorithm over many elements, **demonstrate ONLY 2-3 iterations** then \`self.wait(1)\` — let the narration explain the rest. NEVER run a full bubble sort over 7 elements; that produces a 20+ second scene.

    15. **TEXT MUST FIT SCREEN:**
        *   Any \`Text(...)\` with more than ~50 characters MUST use \`.scale_to_fit_width(12)\` to stay on-screen.
        *   For multi-sentence on-screen text, split into 2-3 short \`Text\` lines and arrange them with \`VGroup(*lines).arrange(DOWN, buff=0.3)\`.
        *   Default screen width is ~14 units; anything wider gets clipped.

    16. **FORBIDDEN ANTI-PATTERNS — Violating any of these causes broken scenes:**
        *   ❌ Manually shifting objects by an index multiplier: \`obj.shift(LEFT * i * 1.5)\` — pushes objects off-screen for i ≥ 3. ✅ Always use \`VGroup(*objects).arrange(RIGHT, buff=0.5)\`.
        *   ❌ Calling \`FadeIn(x)\` on an object that's already on-screen (use \`.animate.set_opacity(1)\` if you really need to "re-fade in").
        *   ❌ Running an entire algorithm to completion when a target duration is given. Show 2-3 iterations and stop.
        *   ❌ Using \`Text(very_long_paragraph)\` without \`.scale_to_fit_width()\`.
        *   ❌ Introducing new example data when "Previous Scenes Context" already names an example.
    --- FEW-SHOT EXAMPLES (Provide 3-5 diverse, high-quality examples) ---

    **EXAMPLE 1: Simple Shape and Text**
    User Input Context:
    Topic: "Introduction to Geometry"
    Scene Number: 1 of 3
    Narration: "Here we have a basic square, and we label it 'Shape A'."
    Visual Description: "A blue square appears on the left side of the screen. The text 'Shape A' in white appears below the square."
    Expected Manim Code Output:
    \`\`\`python
    from manim import *
    import numpy as np

    class GeneratedScene(Scene):
        def construct(self):
            # Create the square
            blue_square = Square(color=BLUE, fill_opacity=0.5).to_edge(LEFT, buff=1)

            # Create the label
            label_a = Text("Shape A", color=WHITE, font_size=36).next_to(blue_square, DOWN, buff=0.3)

            # Animate their appearance
            self.play(Create(blue_square))
            self.play(Write(label_a))
            self.wait(1)
    \`\`\`
    ---

    **EXAMPLE 2: Animation and Transformation**
    User Input Context:
    Topic: "Dynamic Changes"
    Scene Number: 2 of 2
    Previous Scene Context: "A red circle was shown." (Conceptual, must be re-declared)
    Narration: "The red circle now moves to the right and transforms into a green star."
    Visual Description: "A red circle, initially on the left, animates to the right side of the screen. While moving or upon arrival, it smoothly transforms into a green five-pointed star."
    Expected Manim Code Output:
    \`\`\`python
    from manim import *
    import numpy as np

    class GeneratedScene(Scene):
        def construct(self):
            # Re-declare the circle from the conceptual previous scene
            red_circle = Circle(color=RED, fill_opacity=0.7).move_to(LEFT * 3)

            # Define the star
            green_star = Star(n=5, outer_radius=1.0, color=GREEN, fill_opacity=0.7).move_to(RIGHT * 3)

            self.play(Create(red_circle))
            self.wait(0.5)

            # Animate movement and transformation simultaneously
            self.play(red_circle.animate.move_to(RIGHT * 3), Transform(red_circle, green_star), run_time=2)

            self.wait(1)
    \`\`\`
    ---

    **EXAMPLE 3: MathTex and Positioning**
    User Input Context:
    Topic: "Pythagorean Theorem"
    Scene Number: 1 of 5
    Narration: "The Pythagorean theorem states that a squared plus b squared equals c squared."
    Visual Description: "Display the formula 'a^2 + b^2 = c^2' clearly in the center of the screen. Make it white."
    Expected Manim Code Output:
    \`\`\`python
    from manim import *
    import numpy as np

    class GeneratedScene(Scene):
        def construct(self):
            # Display the Pythagorean theorem
            formula = MathTex(r"a^2 + b^2 = c^2", color=WHITE, font_size=72)
            formula.move_to(ORIGIN)

            self.play(Write(formula), run_time=2)
            self.wait(2)
    \`\`\`
    ---

    **EXAMPLE 4: Creating Axes and Plotting a Simple Graph**
    User Input Context:
    Topic: "Linear Functions"
    Scene Number: 1 of 2
    Narration: "Let's visualize the linear function y equals 2x plus 1."
    Visual Description: "Draw a set of Cartesian axes. Then, plot the graph of the function y = 2x + 1 on these axes. The graph line should be yellow."
    Expected Manim Code Output:
    \`\`\`python
    from manim import *
    import numpy as np

    class GeneratedScene(Scene):
        def construct(self):
            # Create axes
            axes = Axes(
                x_range=[-3, 3, 1],
                y_range=[-2, 8, 1],
                x_length=8,
                y_length=6,
                axis_config={"include_numbers": True, "font_size": 24}
            ).add_coordinates()

            # Define the function
            def func(x):
                return 2 * x + 1

            # Create the graph
            graph = axes.plot(func, color=YELLOW)
            graph_label = axes.get_graph_label(graph, label=MathTex("y = 2x + 1"), x_val=1.5, direction=UR)

            self.play(Create(axes), run_time=2)
            self.play(Create(graph), Write(graph_label), run_time=2)
            self.wait(2)
    \`\`\`
    ---

    **EXAMPLE 5: Multi-Part Explanation with Area Under Curve**
    User Input Context:
    Topic: "Understanding Definite Integrals"
    Narration: "What is the area under this curve from x equals a to x equals b?"
    Visual Description: "Show a curve y = x^2/5 + 1. Highlight the area under it between x=1 (labeled 'a') and x=5 (labeled 'b')."
    Expected Manim Code Output:
    \`\`\`python
    from manim import *
    import numpy as np

    # --- Manual Definition of Edge Constants ---
    _FRAME_Y_RADIUS = config.frame_y_radius if "config" in globals() and hasattr(config, "frame_y_radius") else 4.0
    _FRAME_X_RADIUS = config.frame_x_radius if "config" in globals() and hasattr(config, "frame_x_radius") else (16/9) * _FRAME_Y_RADIUS
    BOTTOM = np.array([0, -_FRAME_Y_RADIUS, 0])
    TOP = np.array([0, _FRAME_Y_RADIUS, 0])
    LEFT_SIDE = np.array([-_FRAME_X_RADIUS, 0, 0])
    RIGHT_SIDE = np.array([_FRAME_X_RADIUS, 0, 0])
    # --- End of Manual Definition ---

    class GeneratedScene(Scene):
        def construct(self):
            title_text = Tex("The Definite Integral: Area Under a Curve", font_size=40)
            title_text.to_edge(UP, buff=0.5)
            self.play(Write(title_text))
            self.wait(1)

            axes = Axes(
                x_range=[0, 6, 1], y_range=[0, 8, 1],
                x_length=8, y_length=5,
                axis_config={"include_numbers": True, "tip_shape": StealthTip},
                x_axis_config={"numbers_to_include": np.arange(1, 6, 1)},
                y_axis_config={"numbers_to_include": np.arange(2, 8, 2)},
            ).add_coordinates()
            axes.to_edge(DOWN, buff=1)

            def func(x):
                return x**2 / 5 + 1
            graph = axes.plot(func, x_range=[0.5, 5.5], color=BLUE)
            graph_label = axes.get_graph_label(graph, label=MathTex(r"f(x) = \\frac{x^2}{5} + 1"), x_val=4.5, direction=UR)

            a_val, b_val = 1, 5
            line_a = axes.get_vertical_line(axes.c2p(a_val, func(a_val)), color=YELLOW)
            line_b = axes.get_vertical_line(axes.c2p(b_val, func(b_val)), color=YELLOW)
            a_label = MathTex("a", font_size=36).next_to(axes.c2p(a_val, 0), DOWN)
            b_label = MathTex("b", font_size=36).next_to(axes.c2p(b_val, 0), DOWN)
            area = axes.get_area(graph, x_range=(a_val, b_val), color=[GREEN_C, GREEN_E], opacity=0.7)

            question_text = Tex("What is the area under this curve", " from $x=a$ to $x=b$?", font_size=36)
            question_text.next_to(title_text, DOWN, buff=0.5)

            self.play(Create(axes), Create(graph), Write(graph_label), run_time=2)
            self.play(Write(question_text[0]))
            self.play(Create(line_a), Create(line_b), Write(a_label), Write(b_label), run_time=1.5)
            self.play(Write(question_text[1]))
            self.play(FadeIn(area), run_time=1.5)
            self.wait(2)
    \`\`\`
    ---

    **EXAMPLE 6: Array Visualization with Compare-and-Swap (Sorting Algorithms)**
    User Input Context:
    Topic: "Bubble Sort"
    Scene Number: 3 of 8
    Narration: "We compare 5 and 2. Since 5 is greater than 2, we swap them."
    Visual Description: "An array of 5 boxes labeled with numbers. Highlight the first two boxes in yellow, then swap their positions while keeping the rest in place."
    Expected Manim Code Output:
    \`\`\`python
    from manim import *
    import numpy as np

    class GeneratedScene(Scene):
        def construct(self):
            self.camera.background_color = "#1a1a2e"

            # Build the array as a VGroup of (Square + label) cells so we can move them together.
            values = [5, 2, 8, 1, 9]
            boxes = VGroup()
            for v in values:
                box = Square(side_length=1.0, color=BLUE, fill_opacity=0.3)
                label = Text(str(v), font_size=36, color=WHITE).move_to(box.get_center())
                cell = VGroup(box, label)
                boxes.add(cell)
            boxes.arrange(RIGHT, buff=0.3).move_to(ORIGIN)

            self.play(
                *[Create(c[0]) for c in boxes],
                *[Write(c[1]) for c in boxes],
                run_time=1.5,
            )
            self.wait(0.3)

            i, j = 0, 1
            cell_i = boxes[i]
            cell_j = boxes[j]

            # Highlight the pair being compared (color the squares only, not labels).
            self.play(
                cell_i[0].animate.set_color(YELLOW),
                cell_j[0].animate.set_color(YELLOW),
                run_time=0.6,
            )
            self.wait(0.3)

            # Animate the swap by exchanging positions. Capture centers BEFORE the move.
            pos_i = cell_i.get_center()
            pos_j = cell_j.get_center()
            self.play(
                cell_i.animate.move_to(pos_j),
                cell_j.animate.move_to(pos_i),
                run_time=1.2,
            )

            # Restore the original color.
            self.play(
                cell_i[0].animate.set_color(BLUE),
                cell_j[0].animate.set_color(BLUE),
                run_time=0.4,
            )
            self.wait(1)
    \`\`\`
    KEY PATTERNS demonstrated above (reuse for ANY array, sorting, or data-structure scene):
    - Build the array as \`VGroup\` of (Shape + Text) cells, then \`.arrange(RIGHT, buff=...)\`.
    - Index into the VGroup with \`boxes[i]\`. Each cell is itself a 2-element VGroup: \`cell[0]\` = shape, \`cell[1]\` = label.
    - Swap by snapshotting \`get_center()\` of both cells BEFORE the play call, then \`.animate.move_to(other_center)\` on each in the same \`self.play\`.
    - Do NOT mutate the underlying Python list during a swap animation — let positions tell the story.
    - Highlight by recoloring \`cell[i][0]\` (the shape), not the whole cell (which would also recolor the label).

    --- END FEW-SHOT EXAMPLES ---

    `;

// ==========================================
// ERROR RECOVERY / CODE CORRECTION PROMPT
// ==========================================

/**
 * System prompt for correcting broken Manim code.
 * Includes specific import fix recipes, edge constant boilerplate,
 * string escaping guidance, and Flake8 error patterns.
 */
export const CODE_CORRECTION_SYSTEM_PROMPT = `You are an expert Manim Community Edition v0.18.0 programmer tasked with correcting code that has failed during execution. Your sole task is to analyze the error and fix the Manim Python script so it runs correctly.

**CRITICAL ERROR RECOVERY INSTRUCTIONS:**
1. **Output Format:** Output ONLY the fixed Python code block, starting with \`\`\`python and ending with \`\`\`. Do NOT include ANY other text, explanations, apologies, or remarks outside of this code block.
2. **Scene Class:** Keep the Manim scene class named exactly 'GeneratedScene'. Do not change this name.
3. **Common Import Errors & Fixes:**
   - **INCORRECT:** \`from manim.constants import BLACK, WHITE, BLUE, etc.\`
   - **CORRECT:** \`from manim import BLACK, WHITE, BLUE, RED, etc.\`

   - **INCORRECT:** \`from manim.animation.rate_functions import ease_out_quad\`
   - **CORRECT:** \`from manim.utils.rate_functions import ease_out_quad\`

   - **INCORRECT:** \`from manim import CENTER\`
   - **CORRECT:** \`from manim import ORIGIN\` (use ORIGIN instead of CENTER)

   - **INCORRECT:** \`import manim as m\` or \`from manim import *\`
   - **CORRECT:** \`from manim import Scene, VGroup, Square, etc.\` (import specific components)

4. **Edge Constants:** If using edge constants like TOP, BOTTOM, LEFT_SIDE, RIGHT_SIDE, define them explicitly:
   \`\`\`python
   from manim import config
   import numpy as np
   _FRAME_Y_RADIUS = config.frame_y_radius if "config" in globals() and hasattr(config, "frame_y_radius") else 4.0
   _FRAME_X_RADIUS = config.frame_x_radius if "config" in globals() and hasattr(config, "frame_x_radius") else (16/9) * _FRAME_Y_RADIUS
   BOTTOM = np.array([0, -_FRAME_Y_RADIUS, 0])
   TOP = np.array([0, _FRAME_Y_RADIUS, 0])
   LEFT_SIDE = np.array([-_FRAME_X_RADIUS, 0, 0])
   RIGHT_SIDE = np.array([_FRAME_X_RADIUS, 0, 0])
   \`\`\`

5. **String Escaping:** 
   - Ensure quotes in strings are properly escaped with a backslash
   - Replace HTML tags with properly escaped text
   - Example: \`Text("User's content")\` should be \`Text("User\\'s content")\`

6. **Color Constants:** Use \`from manim import WHITE, YELLOW, GREEN, BLUE, BLACK, RED\` rather than importing from \`manim.constants\`

7. **Module Imports:** If you see "ModuleNotFoundError", ensure you're using the correct import paths for Manim v0.18.0.

8. **Additional Tips:**
   - Add \`run_time=1.5\` or similar to animations that may be too fast
   - Ensure all animation parameters are correctly spelled (e.g., \`fill_opacity\` not \`fill_opactiy\`)
   - Check that all objects are added to the scene using \`self.play()\` or \`self.add()\` before they're used in animations

9. **Flake8 Errors:**
   - Fix indentation issues (E111, E114)
   - Remove unused imports (F401)
   - Fix undefined names (F821)
   - Fix line too long errors (E501) by breaking into multiple lines

10. **HTML in Strings:** If you see HTML tags in strings like \`<br>\`, replace them with proper newlines or escaped characters.

Remember to make minimal changes to fix the issue while preserving the original code's intent. Return ONLY the fixed Python code with no additional comments.`;

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
    previousSceneContext?: string;
}

/**
 * Build the user prompt for Manim code generation.
 * Includes detailed Manim v0.18.0 requirements and edge constant boilerplate.
 */
export function buildCodeGenPrompt(params: SceneCodeGenParams): string {
    return `You are an expert Manim animator. Create Manim Community Edition v0.18.0 compatible Python code for this scene description:

Title: "${params.sceneTitle}"

This is scene ${params.sceneNumber} of ${params.totalScenes} in an explanation about "${params.overallTopic}".

${params.previousSceneContext ? `=== PREVIOUS SCENES CONTEXT (REQUIRED for narrative continuity) ===
${params.previousSceneContext}

⚠ CONSISTENCY REQUIREMENT: The viewer watches all scenes back-to-back. You MUST reuse the SAME concrete example data (arrays, numbers, equations, variables, notation) that earlier scenes established above. Do NOT invent a new example array — extract the existing one from the context above and use it. If earlier scenes used the array \`[5, 2, 8, 1, 9]\`, this scene MUST use \`[5, 2, 8, 1, 9]\`.
=== END PREVIOUS SCENES CONTEXT ===

` : ''}Narration for this scene: "${params.narration}"
Visual description for this scene: "${params.visualDescription}"

TARGET DURATION: ~${params.duration} seconds (HARD CAP: total run_time + waits MUST be ≤ ${(params.duration * 1.5).toFixed(1)} seconds)

CRITICAL REQUIREMENTS FOR MANIM v0.18.0:
1. Use proper imports for Manim v0.18.0. Import specific objects directly from manim:
   - from manim import Scene, VGroup, Square, MathTex, Text, etc.
   - from manim import WHITE, YELLOW, GREEN, BLUE, BLACK, RED
   - from manim import UP, DOWN, LEFT, RIGHT, ORIGIN
   - from manim import Create, Write, FadeIn, Transform, etc.
   - DO NOT use: from manim import * (import specific items needed)
   - DO NOT use: from manim.constants import BLACK (use 'from manim import BLACK' instead)
   - The rate_functions are in manim.utils.rate_functions, not manim.animation.rate_functions

2. For animations that require rate_functions:
   from manim.utils.rate_functions import ease_out_quad, linear, etc.

3. Scene Class Format:
   - Name your scene class exactly 'GeneratedScene'
   - Ensure it has a 'construct' method

4. Do not use HTML tags or formatted strings in text - escape quotes properly.

5. If you need to use constants like TOP, BOTTOM, RIGHT_SIDE, define them explicitly:
   _FRAME_Y_RADIUS = config.frame_y_radius if "config" in globals() and hasattr(config, "frame_y_radius") else 4.0
   _FRAME_X_RADIUS = config.frame_x_radius if "config" in globals() and hasattr(config, "frame_x_radius") else (16/9) * _FRAME_Y_RADIUS
   import numpy as np
   BOTTOM = np.array([0, -_FRAME_Y_RADIUS, 0])
   TOP = np.array([0, _FRAME_Y_RADIUS, 0])
   LEFT_SIDE = np.array([-_FRAME_X_RADIUS, 0, 0])
   RIGHT_SIDE = np.array([_FRAME_X_RADIUS, 0, 0])

Manim Python Code Output (Ensure ONLY the \`\`\`python ... \`\`\` block):
`;
}

export interface CodeCorrectionParams {
    failedCode: string;
    errorStderr: string;
    errorStdout: string;
    errorType?: string;
    parsedError?: string;
    sceneDescription: string;
    attemptNumber: number;
    sceneNumber?: number;
    totalScenes?: number;
    topic?: string;
}

/**
 * Build the user prompt for code correction.
 * Differentiates between linting errors and runtime errors (SculptAI pattern).
 */
export function buildCodeCorrectionPrompt(params: CodeCorrectionParams): string {
    let errorSection = '';

    // Differentiate error types like SculptAI
    if (params.errorType === 'LINTING_ERROR' && params.errorStdout) {
        errorSection = `Error Type: Linting Error (Flake8)
Error Details:
\`\`\`
${params.errorStdout}
\`\`\``;
    } else if (params.errorType === 'MANIM_RUNTIME_ERROR') {
        errorSection = `Error Type: Runtime Error (Manim Execution)
${params.parsedError ? `Parsed Error: ${params.parsedError}` : ''}
MANIM STDERR:
\`\`\`
${params.errorStderr.substring(0, 2000)}
\`\`\`
MANIM STDOUT:
\`\`\`
${params.errorStdout.substring(0, 1000)}
\`\`\``;
    } else {
        // Generic fallback
        errorSection = `Error Type: ${params.errorType || 'Unknown'}
${params.parsedError ? `Parsed: ${params.parsedError}` : ''}

STDERR:
${params.errorStderr.substring(0, 2000)}

STDOUT:
${params.errorStdout.substring(0, 1000)}`;
    }

    return `Original Manim Code with Errors:
\`\`\`python
${params.failedCode}
\`\`\`

${errorSection}

Additional Context:
- Scene Number: ${params.sceneNumber || params.attemptNumber}
- Total Scenes: ${params.totalScenes || 'N/A'}
- Topic: "${params.topic || params.sceneDescription}"
- Correction Attempt: ${params.attemptNumber}

## ORIGINAL SCENE DESCRIPTION:
${params.sceneDescription}

Now provide ONLY the fixed Python code:`;
}
