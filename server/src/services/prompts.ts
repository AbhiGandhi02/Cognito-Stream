/**
 * Centralized prompt templates for Gemini AI interactions.
 *
 * Contains system prompts for:
 * - Full Manim Python scene code generation (rules + canonical patterns)
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
 * Includes detailed API rules for Manim CE v0.18.0 and the canonical patterns
 * that work there. Deliberately carries NO example data: the concrete values
 * for a video are decided once by the prompt-expansion brief and travel in
 * each scene's visual description, so two videos on the same topic do not end
 * up animating an identical array baked into this prompt.
 */
export const MANIM_CODE_SYSTEM_PROMPT = `You are an expert Manim Community Edition v0.18.0 programmer. Your sole task is to generate a complete, syntactically correct, and runnable Manim Python script for a single scene based on the provided narration, visual description, and overall topic.

    **CRITICAL INSTRUCTIONS:**
    0.  **Manim Version:** Generate code compatible with Manim Community Edition **v0.18.0** ONLY. Do not use APIs introduced in v0.19+ (e.g., new tip shapes, restructured rate_functions paths).
    1.  **Output Format:** Output ONLY the Python code block, starting with \`\`\`python and ending with \`\`\`. Do NOT include ANY other text, explanations, apologies, or introductory/concluding remarks outside of this code block.
    2.  **Scene Class:** The Manim scene class MUST be named exactly 'GeneratedScene'. For example: \`class GeneratedScene(Scene):\`.
    3.  **Imports:** Use \`from manim import *\` at the top of the script. If you reference edge constants like \`BOTTOM\`, \`TOP\`, \`LEFT_SIDE\`, \`RIGHT_SIDE\` (not always exported by all Manim versions), define them manually from \`config\`:
        \`\`\`python
        _FY = config.frame_y_radius if "config" in globals() else 4.0
        _FX = config.frame_x_radius if "config" in globals() else (16/9) * _FY
        BOTTOM, TOP = np.array([0, -_FY, 0]), np.array([0, _FY, 0])
        LEFT_SIDE, RIGHT_SIDE = np.array([-_FX, 0, 0]), np.array([_FX, 0, 0])
        \`\`\`
    4.  **Independent Scenes:** Assume each scene is rendered independently. If visual elements from a *conceptual* previous scene are needed (e.g., "the red circle created earlier"), you MUST re-declare and create those elements within the \`construct\` method of the current scene. Do not assume objects persist between separate script executions.
    5.  **Conciseness & Clarity:** Prioritize creating animations that are clear, visually simple, and directly support the provided narration and visual description. Avoid overly complex or distracting animations unless specifically requested.
    6.  **Animation Duration:** The user prompt gives a TIMING BUDGET measured from the narration audio. Hit it — that window is the requirement, not a suggestion, and it varies per scene. Fill the time with animation, not with waiting: rely on explicit \`run_time\` for every \`self.play(...)\` and use \`self.wait(...)\` only for short beats between steps.
    7.  **Common Mobjects:** Focus on using common Manim Mobjects:
        *   Shapes: \`Circle\`, \`Square\`, \`Rectangle\`, \`Triangle\`, \`Line\`, \`Arrow\`, \`Dot\`, \`Polygon\`.
        *   Text: \`Text\` (for plain text), \`MarkupText\` (for Pango markup like bold/italic), \`MathTex\` (for LaTeX formulas - use raw strings like \`r"\\frac{a}{b}"\`).
    8.  **Common Animations:** Focus on common Manim animations:
        *   Creation: \`Create()\`, \`Write()\` (for text), \`FadeIn()\`, \`DrawBorderThenFill()\`.
        *   Transformation: \`Transform()\`, \`ReplacementTransform()\`.
        *   Movement/Modification: \`.animate\` syntax (e.g., \`my_mobject.animate.shift(RIGHT)\`, \`my_mobject.animate.scale(2)\`, \`my_mobject.animate.set_color(BLUE)\`).
        *   Removal: \`FadeOut()\`, \`Uncreate()\`.
    9.  **Positioning:**
        *   Position RELATIVELY — \`.to_edge(EDGE, buff=0.5)\`, \`.next_to(other, DIR, buff=0.3)\`, \`VGroup(...).arrange(...)\`, \`.move_to(ORIGIN)\`. Hand-tuned coordinates are the single biggest cause of clipped and overlapping frames; use them only for geometry that is genuinely coordinate-based (polygon vertices, axes points).
        *   Exact frame: **14.22 × 8.00 units**, x ∈ [-7.11, 7.11], y ∈ [-4.00, 4.00]. This is the same at EVERY render resolution — resolution changes pixels, never units.
        *   A Mobject's whole BOUNDING BOX must fit, not its center. Putting a center at y=4 clips the top half of it.
        *   For titles, use \`Text(..., font_size=36).to_edge(UP, buff=0.5)\`. Do not call \`.scale_to_fit_*\` on Axes / DashedVMobject / other compound Mobjects — control size via \`font_size\` (Text/MathTex), \`x_length\`/\`y_length\` (Axes), or \`scale(0.7)\` for the whole VGroup after construction.
        *   Use \`np.array([x, y, z])\` for coordinates; ensure \`import numpy as np\` if using it.
    10. **Colors:** Use Manim's predefined colors like \`RED\`, \`BLUE\`, \`GREEN\`, \`YELLOW\`, \`WHITE\`, \`BLACK\`, or hex codes like \`"#RRGGBB"\`.
    11. **Error Avoidance:**
        *   Avoid methods deprecated or removed in Manim CE v0.18.0.
        *   Ensure all variables are defined before use.
        *   For \`Polygon\`, define vertices first, e.g., \`poly = Polygon(v1, v2, v3)\`. To get sides, you might need to create \`Line\` objects between vertices: \`Line(v1, v2)\`. Do NOT use non-existent methods like \`polygon.get_lines()\`.
        *   When using \`MathTex\` or \`Tex\`, ensure the LaTeX string is valid and use raw strings (e.g., \`r"\\sum"\`).
        *   Colour and constant imports come from \`manim\` itself — NEVER \`from manim.constants import BLACK\`, which is not a valid path.
        *   Rate functions live in \`manim.utils.rate_functions\` (\`from manim.utils.rate_functions import ease_out_quad, linear\`) — NOT \`manim.animation.rate_functions\`.
        *   No HTML tags anywhere inside a \`Text\`/\`MathTex\` string (\`<br>\`, \`<b>\` — Pango and LaTeX render them literally or break), and escape quotes properly.
        *   When using \`ValueTracker\` with \`always_redraw\` for text labels showing the tracker's value, use \`DecimalNumber\` for the numerical part to avoid excessive TeX recompilation.
    12. **Tangent lines:** DO NOT call \`axes.get_tangent_line()\` — its kwargs vary across Manim versions and break in CE 0.18.0. Build a tangent manually: compute the slope numerically, pick two points \`p1 = axes.c2p(x - dx, y - slope*dx)\` and \`p2 = axes.c2p(x + dx, y + slope*dx)\`, then \`Line(p1, p2, color=YELLOW)\`.
    13. **Cross-Scene Consistency (CRITICAL):** The concrete data for this video is given to you — in the scene's visual description, and in the "already drawn on screen" context when earlier scenes exist. Use exactly those values: same numbers, same order, same equations, same variable names, same notation. Never substitute data you have seen elsewhere, and never invent a fresh example midway. The viewer is watching every scene back-to-back; changing the example breaks the lesson.
        *   The visual description states which elements CARRY OVER from the previous scene and which are NEW here. Honour that split: re-create the carried-over ones with the same construction, size, colour and position as before so the cut looks continuous, and reserve the animated entrance (\`Create\`/\`Write\`/\`FadeIn\`) for the new ones. Carried-over elements should already be on screen — \`self.add(...)\` them, or reveal them in a single fast \`FadeIn\` at the top of the scene, never re-drawn slowly as though the viewer has not seen them.
        *   The visual description also states what MOVES or CHANGES and in what order. That ordering is the scene's spine — follow it, so the motion lines up with the sentence being spoken over it.

    14. **TIMING BUDGET (CRITICAL):** The user prompt gives a TIMING BUDGET — a window in seconds, derived from the length of the narration this animation plays under. Your TOTAL animation time (sum of every \`run_time\` and every \`self.wait()\`) MUST land inside that window. Add the numbers up and check before you answer.
        *   Undershooting freezes the screen while the narrator is still speaking; overshooting gets the animation cut off mid-motion. Both are visible defects.
        *   A LONG budget is not permission to pad. Fill it with substance: more steps, intermediate states, labels appearing as the narration mentions them, a slower \`run_time\` on the moves that matter.
        *   A SHORT budget means show less, not rush. Cut steps rather than compressing every \`run_time\` to 0.3.
        *   When demonstrating an iterative algorithm, show as many iterations as the budget affords — roughly 2-3 for a 10-second scene, more when there is room — and let the narration cover the rest. Do not compress a 7-element sort into a scene with no time for it.

    15. **SAFE AREA — NOTHING MAY BE CLIPPED:**
        The frame is 14.22 × 8.00 units. Never build to the full frame: keep a
        margin so nothing touches an edge on any display.

        *   **Safe area: x ∈ [-6.5, 6.5], y ∈ [-3.4, 3.4]** — i.e. max content 13.0 wide × 7.0 tall.
        *   Text is narrower still: any \`Text(...)\` over ~50 characters MUST be capped at width 12 (\`.scale_to_fit_width(12)\` on a plain \`Text\` is fine).
        *   For multi-sentence on-screen text, split into 2-3 short \`Text\` lines and arrange them with \`VGroup(*lines).arrange(DOWN, buff=0.3)\`.
        *   **Emit this helper and route every group through it before animating.** It measures the real object and only ever shrinks, so it cannot make anything worse:
            \`\`\`python
            SAFE_W, SAFE_H = 13.0, 7.0

            def fit_to_screen(m, max_w=SAFE_W, max_h=SAFE_H):
                f = min(max_w / max(m.width, 1e-6), max_h / max(m.height, 1e-6), 1.0)
                if f < 1.0:
                    m.scale(f)
                return m
            \`\`\`
            Use \`fit_to_screen(group)\` on each top-level VGroup once it is built and
            arranged, BEFORE the \`self.play(...)\` that reveals it.
        *   Uniform \`.scale()\` — which is all the helper does — is safe on compound
            Mobjects including \`Axes\`: scale the VGroup holding \`(axes, graph, labels)\`
            together and \`axes.c2p()\` still maps correctly. What you must NOT do is call
            \`.scale_to_fit_width/height()\` on a bare \`Axes\` or \`DashedVMobject\`.
        *   When a title is present, the content band is only ~5.0 tall (see rule 17), so pass \`max_h=5.0\` for the body group.

    16. **FORBIDDEN ANTI-PATTERNS:**
        *   ❌ \`obj.shift(LEFT * i * X)\` index-multiplier positioning — use \`VGroup(*objects).arrange(RIGHT, buff=0.5)\`.
        *   ❌ \`FadeIn(x)\` on an already-on-screen object — use \`.animate.set_opacity(1)\`.
        *   ❌ Padding the timing budget with one long trailing \`self.wait()\` instead of animating.
        *   ❌ Introducing new example data when "Previous Scenes Context" names one — reuse it exactly.
        *   ❌ Writing a new Text/MathTex at the SAME position as an existing one without \`FadeOut(old)\` or \`ReplacementTransform(old, new)\` first — letters stack and become unreadable.
        *   ❌ Hand-tuned absolute coordinates for layout (\`.shift(UP * 2.7)\`, \`.move_to([3.4, -1.8, 0])\`) — positions drift as content changes and end up clipped or stacked. Use \`arrange\` / \`next_to\` / \`to_edge\`.
        *   ❌ Building anything wider than 13.0 or taller than 7.0 units without routing it through \`fit_to_screen()\`.
        *   ❌ Passing dash-related kwargs to shape constructors (\`stroke_dash_length\`, \`dash_length\`, \`dashed\`, etc.) — these crash \`set_stroke()\`. For dashed shapes use \`DashedVMobject(shape, num_dashes=40)\`.

    17. **NO OVERLAPPING — RESERVE ZONES:**
        Split the frame into three horizontal bands and never let two different
        things occupy the same one at the same time.

        *   **TITLE band** (y ≈ 2.9 to 3.5): one \`Text(..., font_size=40).to_edge(UP, buff=0.5)\`. Nothing else, ever.
        *   **CONTENT band** (y ∈ [-2.5, 2.5], max 13.0 × 5.0): the diagram, array, axes or formula. Build it as ONE VGroup, \`.arrange()\` it, \`fit_to_screen(g, max_h=5.0)\`, then \`.move_to(ORIGIN)\`.
        *   **CAPTION band** (y ≈ -3.5 to -2.9): at most one short \`Text\` via \`.to_edge(DOWN, buff=0.5)\`.

        Rules that keep them from colliding:
        *   Only ONE group may sit at \`ORIGIN\`. Before moving a second group there, \`FadeOut\` the first or \`ReplacementTransform\` into it.
        *   Before writing into a band that already holds something, remove what is there: \`self.play(FadeOut(old), run_time=0.5)\` or \`ReplacementTransform(old, new)\`.
        *   Stack with \`VGroup(*items).arrange(DOWN, buff=0.4)\` and place side by side with \`.arrange(RIGHT, buff=0.8)\`. Never position siblings with individual \`.shift()\` calls — that is how items land on top of each other.
        *   Attach a label to its object with \`.next_to(obj, DIR, buff=0.2)\`, never \`.move_to(obj)\` — the one exception is centring a value INSIDE its own box, e.g. \`label.move_to(box.get_center())\`.
        *   Every \`next_to\` / \`arrange\` needs an explicit \`buff\` of at least 0.2; touching edges read as overlap on a small screen.
        *   A formula and the diagram it describes go in ONE \`VGroup(...).arrange(DOWN, buff=0.5)\`, not at two separately chosen positions.

    18. **THE NARRATION IS SPOKEN, THE SCREEN IS SYMBOLIC — DO NOT TRANSCRIBE:**
        The narration you are given is written to be read aloud by a speech
        engine, so every symbol in it is spelled out phonetically. The screen
        must show the SYMBOLIC form instead. They are two renderings of the same
        idea, never the same string.

        *   Narration says "a squared plus b squared equals c squared" → screen shows \`MathTex(r"a^2 + b^2 = c^2")\`.
        *   Narration says "f of x equals x squared minus four" → screen shows \`MathTex(r"f(x) = x^2 - 4")\`.
        *   Narration says "two point five metres per second" → screen shows \`Text("2.5 m/s")\` or \`MathTex(r"2.5\\,\\text{m/s}")\`.
        *   Narration says "the array seven, two, nine, four, one" → screen shows the boxes \`7 2 9 4 1\`, not that sentence.
        *   ❌ NEVER \`Text("a squared plus b squared equals c squared")\`. Putting the spoken words on screen is the failure this rule exists to prevent.
        *   Do not caption the scene with the narration text either. On-screen text is labels, values and notation — short. The narration is the audio track; it is never subtitles.

    19. **UNITS AND QUANTITIES (physics and applied topics):**
        *   Keep the number and its unit in ONE mobject so they can never separate: \`Text("6 N", font_size=28)\` or \`MathTex(r"6\\,\\text{N}")\`.
        *   Label a quantity with its symbol AND value where the narration names both: \`Text("F = 6 N")\`.
        *   Stack multiple givens as \`VGroup(*labels).arrange(DOWN, buff=0.2)\` in one corner, not scattered around the diagram.

    **CRITICAL API REFERENCE (most-frequently-broken signatures — copy these patterns exactly):**

    Constructors — keyword arguments are required where shown:
    *   \`Star(n=5, outer_radius=1.0, inner_radius=0.5, color=BLUE, fill_opacity=0.6)\` — NOT \`Star(5, 1.0)\`
    *   \`Circle(radius=1.0, color=BLUE, fill_opacity=0.5)\`
    *   \`Square(side_length=1.0, color=GREEN)\`
    *   \`Rectangle(width=2.0, height=1.0, color=RED)\`
    *   \`Polygon(v1, v2, v3, ..., color=YELLOW)\` where each \`vN = np.array([x, y, 0])\`
    *   \`Text("hello", font_size=36, color=WHITE)\` — keyword is \`font_size\`, NOT \`size\`
    *   \`MathTex(r"\\frac{a}{b}", font_size=48, color=WHITE)\` — RAW string mandatory
    *   \`Arrow(start_point, end_point, color=BLUE, buff=0.1, stroke_width=4)\`
    *   \`Line(start_point, end_point, color=GRAY, stroke_width=3)\`

    Axes & plotting:
    *   \`axes = Axes(x_range=[-3, 3, 1], y_range=[-2, 8, 1], x_length=7, y_length=5, axis_config={"include_numbers": True, "font_size": 24})\`
    *   \`graph = axes.plot(lambda x: x**2, color=YELLOW, x_range=[-2, 2])\`
    *   \`point = axes.c2p(x_val, y_val)\` — convert axes coords to scene point
    *   \`axes.get_graph_label(graph, label=MathTex(r"y=x^2"), x_val=1.5, direction=UR)\`

    Animations — prefer GROUPED \`self.play\` over sequential calls:
    *   ✅ \`self.play(Create(a), Create(b), Write(c), run_time=1.5)\`  (visually parallel)
    *   ❌ \`self.play(Create(a)); self.play(Create(b)); self.play(Write(c))\`  (slow, choppy)
    *   ALWAYS pass \`run_time=...\` explicitly so timing is predictable.
    *   For \`.animate\`: \`obj.animate.shift(RIGHT * 2).set_color(RED).scale(1.2)\` — chain in one expression.

    Camera & style defaults (set these at the top of \`construct\`):
    *   \`self.camera.background_color = "#1a1a2e"\` (consistent dark navy across the project)
    *   Title font_size 40-48; body 28-36; labels 22-28.
    *   Stick to a 2-3 color palette per scene. Pick from BLUE/GREEN/YELLOW/RED + WHITE for contrast.

    --- CANONICAL PATTERNS ---
    These are the idioms that work in CE 0.18.0. Apply them to whatever data
    the scene brief specifies — never to a remembered example. The concrete
    values to draw always come from the scene's visual description.

    **Arrays / lists / any indexed data structure:**
    *   Build each cell as \`VGroup(Square(...), Text(str(value), ...).move_to(box.get_center()))\`, collect cells in an outer \`VGroup\`, then \`.arrange(RIGHT, buff=0.3).move_to(ORIGIN)\`.
    *   Index with \`cells[i]\`; within a cell, \`cell[0]\` is the shape and \`cell[1]\` the label.
    *   To highlight, recolor the SHAPE only: \`cell[0].animate.set_color(YELLOW)\` — recoloring the whole VGroup washes out the label.
    *   To swap two cells, snapshot BOTH centers before the play call, then move each to the other's center inside ONE \`self.play\`:
        \`pos_i, pos_j = cell_i.get_center(), cell_j.get_center()\` then \`self.play(cell_i.animate.move_to(pos_j), cell_j.animate.move_to(pos_i), run_time=1.2)\`.
    *   Do NOT mutate the underlying Python list during a swap animation — let the positions tell the story.
    *   Create the whole row in one call: \`self.play(*[Create(c[0]) for c in cells], *[Write(c[1]) for c in cells], run_time=1.5)\`.

    **Graphs and functions:**
    *   \`axes = Axes(x_range=[...], y_range=[...], x_length=8, y_length=6, axis_config={"include_numbers": True, "font_size": 24})\`, then \`axes.plot(func, color=YELLOW)\`.
    *   Label with \`axes.get_graph_label(graph, label=MathTex(r"..."), x_val=..., direction=UR)\`; place points with \`axes.c2p(x, y)\`.
    *   Draw the axes first, then the curve: \`self.play(Create(axes), run_time=2)\` then \`self.play(Create(graph), Write(label), run_time=2)\`.

    **Physics scenarios (bodies, forces, motion):**
    *   Ground/surface as \`Line(LEFT * 4, RIGHT * 4, color=GRAY, stroke_width=4)\`; a body as \`Square(side_length=1.2, color=BLUE, fill_opacity=0.6).next_to(ground, UP, buff=0)\`.
    *   Forces are \`Arrow(start, end, color=..., buff=0.05)\` anchored to the body's own edges (\`block.get_left()\`, \`block.get_top()\`) — never to hand-picked coordinates. Colour by role and keep that mapping all video.
    *   Angles: \`Angle(line1, line2, radius=0.5, color=YELLOW)\`. Dimensions: \`Brace(obj, DOWN)\` then \`brace.get_text("1.2 m")\`.
    *   Motion is \`body.animate.shift(RIGHT * d)\` inside \`self.play(..., run_time=t)\`, with arrows attached via \`always_redraw\` if they must follow. Live readouts use \`DecimalNumber\` + \`ValueTracker\`, never re-created \`MathTex\`.
    *   Group the whole apparatus into one \`VGroup\` and \`fit_to_screen()\` it, so adding a force arrow later cannot push the diagram off-frame.

    **Trees, graphs and linked structures:**
    *   Use the built-in: \`Graph(vertices, edges, layout="tree", root_vertex=1, labels=True, vertex_config={"fill_color": BLUE}, edge_config={"stroke_color": GREY})\`. \`vertices\` is a list of hashables, \`edges\` a list of 2-tuples.
    *   Other layouts: \`"spring"\` (default), \`"circular"\`, \`"shell"\`. \`layout="tree"\` REQUIRES \`root_vertex\`.
    *   Reach one node with \`graph.vertices[k]\` and one edge with \`graph.edges[(u, v)]\` to highlight: \`self.play(graph.vertices[3].animate.set_color(YELLOW), run_time=0.8)\`.
    *   Scale the whole \`Graph\` with \`fit_to_screen()\` — it is a compound Mobject, so never \`scale_to_fit_*\` it directly.

    **Strings and character sequences:**
    *   Same cell pattern as arrays: one \`VGroup(Square(...), Text(ch, font_size=30))\` per character, then \`.arrange(RIGHT, buff=0.15)\`. Index pointers are an \`Arrow\` or \`Triangle\` placed with \`.next_to(cells[i], UP, buff=0.2)\` and moved with \`.animate.next_to(cells[j], UP, buff=0.2)\`.

    **Referring back to something an earlier scene drew:**
    *   Each scene is a separate script — nothing persists. Re-declare the object with the SAME construction and color, then continue.
    *   Morph with \`ReplacementTransform(old, new)\` (not \`Transform\`) when the old object should be gone afterwards.

    **Shape of a scene:**
    *   Set \`self.camera.background_color = "#1a1a2e"\` first, build objects, then animate in grouped \`self.play(...)\` calls, each with an explicit \`run_time\`.
    *   End with \`self.wait(0.5)\` to let the final frame settle.
    --- END CANONICAL PATTERNS ---

    ============================================================
    REMEMBER — Final checklist before you output your code:
    ============================================================
    1. Class is named exactly \`GeneratedScene\` with a \`def construct(self):\` method.
    2. \`from manim import *\` and \`import numpy as np\` at the very top.
    3. NO manual index shifts (\`LEFT * i * X\`). Use \`VGroup(*items).arrange(RIGHT, buff=0.5)\`.
    4. Reuse example data from "Previous Scenes Context" — never invent a new array mid-explanation.
    5. Total animation time (run_time + waits) lands inside the TIMING BUDGET window. Add it up.
    6. Long Text() → \`.scale_to_fit_width(12)\`. MathTex/Tex → \`r"..."\` raw strings.
    6a. \`fit_to_screen()\` is defined and every top-level group passes through it. Nothing exceeds 13.0 × 7.0 units.
    6b. Title / content / caption bands each hold at most one thing, and only one group sits at ORIGIN.
    6c. No on-screen Text repeats the spoken narration — the screen shows symbols, values and short labels.
    7. Group simultaneous animations: \`self.play(a, b, c, run_time=...)\`. Always pass \`run_time\`.
    8. End \`construct\` with \`self.wait(0.5)\` to let the final frame settle — not to fill time.
    9. Output ONLY the \`\`\`python ... \`\`\` block. No prose, no apologies, no commentary.
    10. Use the constructor signatures from the CRITICAL API REFERENCE — don't guess.
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

   - **INCORRECT:** \`import manim as m\` (the alias breaks every bare Mobject name)
   - **CORRECT:** \`from manim import *\` — KEEP the star import. Do not rewrite it into
     a list of explicit names: any name you miss becomes an F821 lint failure,
     and the linter already ignores F403/F405.

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

6. **Color Constants:** Colors arrive via \`from manim import *\` — never from \`manim.constants\`, which is not a valid import path.

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
    /**
     * Why the last attempt at this exact scene failed, when this is a retry.
     * Without it a retry regenerates blind and can reproduce the same mistake:
     * the scene's errorMessage is cleared before regeneration and was never
     * part of this prompt, so only the repair loop ever saw a real error.
     */
    previousFailure?: string;
    /**
     * The video-level brief (example data, key terms, scope), when the
     * storyboard has one stored. Matters most on a RETRY: the scene is
     * regenerated from scratch long after planning, and without this the only
     * surviving trace of the worked example is its own visual description.
     */
    briefContext?: string;
    /**
     * Word count of the narration. Shown alongside the duration so the model
     * can sanity-check the budget against the script it is pacing to, rather
     * than trusting a bare number.
     */
    narrationWordCount?: number;
}

/**
 * Build the user prompt for Manim code generation.
 * Includes detailed Manim v0.18.0 requirements and edge constant boilerplate.
 */
export function buildCodeGenPrompt(params: SceneCodeGenParams): string {
    return `You are an expert Manim animator. Create Manim Community Edition v0.18.0 compatible Python code for this scene description:

Title: "${params.sceneTitle}"

This is scene ${params.sceneNumber} of ${params.totalScenes} in an explanation about "${params.overallTopic}".

${params.previousSceneContext ? `=== WHAT THE VIEWER HAS ALREADY SEEN (REQUIRED for continuity) ===
${params.previousSceneContext}

⚠ CONSISTENCY REQUIREMENT — this is a hard constraint, not a preference.
The viewer watches these scenes back-to-back as one continuous video. Anything
listed under "Already drawn on screen" above was literally rendered in an
earlier scene and the viewer remembers it.

  * REUSE the exact example data shown above — the same values, in the same
    order. Not a new example, not the same one reordered or extended. If the
    data has legitimately changed because an earlier scene transformed it
    (a sort mid-way through, say), continue from THAT state.
  * REUSE the same colors for the same roles. If bars were BLUE and the
    highlight was YELLOW, keep that mapping.
  * REUSE the same notation and variable names. If an earlier scene wrote
    \`n \\log n\`, do not switch to \`O(n \\log n)\` here.
  * This scene is rendered as a standalone script, so you must RE-CREATE those
    objects from scratch — matching what was drawn before, not importing it.

Introducing fresh example data mid-explanation is the single most damaging
mistake you can make here: the narration will refer to "our array" while the
screen shows numbers the viewer has never seen.
=== END OF WHAT THE VIEWER HAS ALREADY SEEN ===

` : ''}${params.briefContext ? `=== THE VIDEO THIS SCENE BELONGS TO ===
${params.briefContext}
Use these exact values and terms. They were fixed once for the whole video, and
every other scene was built against them.
=== END ===

` : ''}${params.previousFailure ? `=== A PREVIOUS ATTEMPT AT THIS SCENE FAILED ===
You are re-writing this scene from scratch because the last attempt could not
be rendered. This is what went wrong:

${params.previousFailure}

Do not reproduce that mistake. If it names a Manim class, method or keyword
argument, that thing does not exist or does not accept those arguments in CE
0.18.0 — reach for a different construction rather than a variation on the same
one. If it is a layout or timing failure, change the approach, not the numbers.
=== END OF PREVIOUS FAILURE ===

` : ''}Narration for this scene: "${params.narration}"
Visual description for this scene: "${params.visualDescription}"

=== TIMING BUDGET (READ CAREFULLY — THIS IS A HARD REQUIREMENT) ===
The narration above is spoken over this animation. It takes **${params.duration} seconds**${params.narrationWordCount ? ` (${params.narrationWordCount} words)` : ''} to say out loud.

Your animation MUST last **${(params.duration * 0.9).toFixed(1)}–${(params.duration * 1.1).toFixed(1)} seconds**: sum every \`run_time\` and every \`self.wait(...)\` in \`construct()\` and check the total falls in that window before you answer.

- **Too short** and the screen freezes on its final frame while the narrator is still talking.
- **Too long** and the animation is cut off mid-motion when the narration ends.

Pace the visuals to the words. Walk through the narration and give each idea in
it its own beat on screen, so what the viewer sees matches what they are
hearing at that moment.

To reach ${params.duration}s, ADD CONTENT — more steps, more intermediate
states, labels appearing as they are mentioned, a slower \`run_time\` on the
important moves. Do NOT pad with one long \`self.wait()\` at the end; a static
screen is exactly the failure this budget exists to prevent. A single trailing
\`self.wait(0.5)\` to let the last frame settle is fine.
=== END TIMING BUDGET ===

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
