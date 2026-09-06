/**
 * Cross-scene continuity context.
 *
 * Each scene is rendered as a standalone Python script with no shared state,
 * so the only thing keeping a five-scene video coherent is the "previous
 * scenes" block injected into each scene's code-gen brief.
 *
 * That block used to carry only planning text — the narration and visual
 * description written by the storyboard step. But the things that actually
 * need to stay consistent (the example array, the bar colours, the notation)
 * are invented by the CODE generator, not the planner, and lived only in the
 * previous scene's Python. So the prompt demanded "reuse [5, 2, 8, 1, 9]" from
 * a model that had never been shown that array.
 *
 * This module closes that gap by extracting the concrete decisions back out of
 * the generated code. Extraction is deterministic — regex over the source, no
 * extra LLM call — because this runs once per scene on the hot path and a
 * wrong answer here is worse than no answer.
 */

// ==========================================
// FACT EXTRACTION
// ==========================================

export interface SceneFacts {
    /** Numeric list literals, e.g. "[5, 2, 8, 1, 9]" — the example data. */
    arrays: string[];
    /** Manim colour constants and hex literals actually used. */
    colors: string[];
    /** MathTex / Tex source strings — the notation established. */
    notation: string[];
    /** On-screen Text labels. */
    labels: string[];
}

// At least two numbers, so a coordinate pair like [0, 1] is caught but a bare
// index is not. Deliberately loose: over-reporting an array is harmless
// context, missing the example array is the failure this exists to prevent.
const ARRAY_PATTERN = /\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)+\s*\]/g;

const COLOR_NAMES = [
    'WHITE', 'BLACK', 'GRAY', 'GREY', 'LIGHT_GRAY', 'DARK_GRAY', 'LIGHT_GREY',
    'DARK_GREY', 'RED', 'GREEN', 'BLUE', 'YELLOW', 'GOLD', 'TEAL', 'PURPLE',
    'PINK', 'MAROON', 'ORANGE', 'LIGHT_BROWN', 'DARK_BROWN', 'PURE_RED',
    'PURE_GREEN', 'PURE_BLUE',
];
const COLOR_PATTERN = new RegExp(
    `\\b(?:${COLOR_NAMES.join('|')})(?:_[A-E])?\\b|#[0-9a-fA-F]{6}\\b`,
    'g'
);

// First string argument of MathTex(...) / Tex(...), with or without an r-prefix.
const NOTATION_PATTERN = /\b(?:MathTex|Tex)\s*\(\s*[rRfFbB]{0,2}(["'])((?:\\.|(?!\1).)*)\1/g;
// Same for Text(...) / MarkupText(...).
const LABEL_PATTERN = /\b(?:Text|MarkupText)\s*\(\s*[rRfFbB]{0,2}(["'])((?:\\.|(?!\1).)*)\1/g;

// Caps keep the block small — it is prepended to every subsequent scene's
// prompt, so N scenes in costs O(N^2) tokens if this is allowed to grow.
const MAX_ARRAYS = 3;
const MAX_COLORS = 6;
const MAX_NOTATION = 4;
const MAX_LABELS = 4;

function uniqueMatches(
    code: string,
    pattern: RegExp,
    limit: number,
    group = 0
): string[] {
    const seen = new Set<string>();
    // Patterns are module-level and carry /g state between calls.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
        const value = (match[group] ?? '').trim();
        if (value) seen.add(value);
        if (seen.size >= limit) break;
        // Zero-length matches would spin forever.
        if (match.index === pattern.lastIndex) pattern.lastIndex++;
    }
    return [...seen];
}

/**
 * Every scene sets `self.camera.background_color = "#1a1a2e"` because the
 * system prompt requires it, so that hex was being reported to the next scene
 * as an established palette colour — burning one of MAX_COLORS on a constant
 * and diluting the colours that carry actual meaning.
 */
function stripBackgroundColor(code: string): string {
    return code.replace(/background_color\s*=\s*[^,)\n]+/g, '');
}

export function extractSceneFacts(manimCode: string): SceneFacts {
    const code = stripBackgroundColor(manimCode || '');
    return {
        arrays: uniqueMatches(code, ARRAY_PATTERN, MAX_ARRAYS),
        colors: uniqueMatches(code, COLOR_PATTERN, MAX_COLORS),
        notation: uniqueMatches(code, NOTATION_PATTERN, MAX_NOTATION, 2),
        labels: uniqueMatches(code, LABEL_PATTERN, MAX_LABELS, 2),
    };
}

// ==========================================
// CONTEXT BLOCK
// ==========================================

export interface SceneContextEntry {
    sceneNumber: number;
    narration: string;
    visualDescription: string;
    /** The generated Python, when this scene has been written yet. */
    manimCode?: string | null;
}

/** Trim at a word boundary so the model never reads a half-word. */
function clip(text: string, max: number): string {
    const value = (text || '').trim().replace(/\s+/g, ' ');
    if (value.length <= max) return value;
    const cut = value.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function formatFacts(facts: SceneFacts): string[] {
    const parts: string[] = [];
    if (facts.arrays.length) parts.push(`example data ${facts.arrays.join(', ')}`);
    if (facts.colors.length) parts.push(`colors ${facts.colors.join(', ')}`);
    if (facts.notation.length) {
        parts.push(`notation ${facts.notation.map((n) => `"${clip(n, 60)}"`).join(', ')}`);
    }
    if (facts.labels.length) {
        parts.push(`on-screen text ${facts.labels.map((l) => `"${clip(l, 40)}"`).join(', ')}`);
    }
    return parts;
}

// How much of each earlier scene to show.
//
// Not uniform, because earlier scenes matter for different reasons. The scene
// immediately before this one governs continuity — what is still on screen,
// what just moved — and the planner now writes that into the visual
// description ("CARRIED OVER: ... NEW: ..."). Older scenes matter only for
// keeping the example data, notation and colours consistent, and that lives in
// the extracted facts, not the prose.
//
// A flat 100-char clip cut every description in half, and the half it removed
// was the "what is new / what moves" half — the part the next scene needs
// most. Widening it uniformly instead would grow the block O(N) per scene and
// O(N^2) across a video, which matters now that a storyboard can run to 12
// scenes.
const RECENT_SCENES_IN_FULL = 2;
const RECENT_VISUAL_CHARS = 280;
const RECENT_NARRATION_CHARS = 260;
const OLDER_VISUAL_CHARS = 100;
const OLDER_NARRATION_CHARS = 120;

/**
 * Render the continuity block handed to a scene's code-gen brief.
 *
 * Entries are sorted by scene number rather than by completion time: the batch
 * pipeline finishes scenes out of order, and handing the model a scrambled
 * chronology of a lesson whose whole point is sequence defeats the purpose.
 *
 * Returns '' when there is nothing to say, so scene 1 gets no empty block.
 */
export function buildSceneContext(entries: SceneContextEntry[]): string {
    const ordered = [...entries].sort((a, b) => a.sceneNumber - b.sceneNumber);
    if (ordered.length === 0) return '';

    const lines: string[] = [];
    ordered.forEach((entry, index) => {
        const isRecent = index >= ordered.length - RECENT_SCENES_IN_FULL;
        const visualChars = isRecent ? RECENT_VISUAL_CHARS : OLDER_VISUAL_CHARS;
        const narrationChars = isRecent ? RECENT_NARRATION_CHARS : OLDER_NARRATION_CHARS;

        lines.push(
            `Scene ${entry.sceneNumber} — "${clip(entry.visualDescription, visualChars)}"`
        );
        lines.push(`  Narration: ${clip(entry.narration, narrationChars)}`);

        if (entry.manimCode) {
            const parts = formatFacts(extractSceneFacts(entry.manimCode));
            if (parts.length) {
                lines.push(`  Already drawn on screen: ${parts.join('; ')}`);
            }
        } else {
            // No code yet (or the scene never got that far). Say so explicitly
            // rather than letting its absence read as "nothing was established".
            lines.push('  (animation for this scene was not generated)');
        }
    });
    return lines.join('\n');
}
