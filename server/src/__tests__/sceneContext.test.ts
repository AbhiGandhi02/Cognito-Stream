// ==========================================
// SCENE CONTEXT TESTS
// ==========================================
//
// These guard cross-scene continuity. The context block is the only thing
// keeping a multi-scene video coherent, and it previously carried planning
// text only — so it could never tell scene 3 which array scene 1 had drawn.

import {
  extractSceneFacts,
  buildSceneContext,
  type SceneContextEntry,
} from '../services/sceneContext';

const SORTING_SCENE = `from manim import *
import numpy as np

class GeneratedScene(Scene):
    def construct(self):
        values = [5, 2, 8, 1, 9]
        title = Text("Bubble Sort", font_size=40)
        bars = VGroup(*[Rectangle(height=v * 0.4, width=0.6, color=BLUE, fill_opacity=0.8) for v in values])
        bars.arrange(RIGHT, buff=0.3)
        self.play(Write(title), run_time=1.2)
        self.play(bars[0].animate.set_color(YELLOW), run_time=0.8)
        complexity = MathTex(r"O(n^2)", font_size=36)
        self.play(Write(complexity), run_time=1.0)
        self.wait(0.5)
`;

describe('extractSceneFacts', () => {
  it('pulls the example array out of the generated code', () => {
    // The whole point: this value exists only in the Python, never in the plan.
    expect(extractSceneFacts(SORTING_SCENE).arrays).toContain('[5, 2, 8, 1, 9]');
  });

  it('captures the colours actually used', () => {
    const { colors } = extractSceneFacts(SORTING_SCENE);
    expect(colors).toEqual(expect.arrayContaining(['BLUE', 'YELLOW']));
  });

  it('captures notation from MathTex', () => {
    expect(extractSceneFacts(SORTING_SCENE).notation).toContain('O(n^2)');
  });

  it('captures on-screen text labels', () => {
    expect(extractSceneFacts(SORTING_SCENE).labels).toContain('Bubble Sort');
  });

  it('recognises hex colours and colour variants', () => {
    const { colors } = extractSceneFacts(
      'c = "#1a1a2e"\nbar = Square(color=BLUE_E)\ndot = Dot(color=RED)'
    );
    expect(colors).toEqual(expect.arrayContaining(['#1a1a2e', 'BLUE_E', 'RED']));
  });

  it('ignores single numbers in brackets', () => {
    expect(extractSceneFacts('bars[0].set_color(RED)').arrays).toHaveLength(0);
  });

  it('deduplicates repeated values', () => {
    const { colors } = extractSceneFacts('a=BLUE\nb=BLUE\nc=BLUE');
    expect(colors).toEqual(['BLUE']);
  });

  it('returns empty facts for empty or junk input', () => {
    for (const input of ['', '   ', 'not python at all']) {
      const facts = extractSceneFacts(input);
      expect(facts.arrays).toHaveLength(0);
      expect(facts.notation).toHaveLength(0);
    }
  });

  it('does not carry regex state between calls', () => {
    // Module-level /g patterns share lastIndex; a leak here would make the
    // second call silently miss the array.
    const first = extractSceneFacts(SORTING_SCENE);
    const second = extractSceneFacts(SORTING_SCENE);
    expect(second).toEqual(first);
    expect(second.arrays).toContain('[5, 2, 8, 1, 9]');
  });
});

describe('buildSceneContext', () => {
  const entry = (n: number, code?: string | null): SceneContextEntry => ({
    sceneNumber: n,
    narration: `Narration for scene ${n}.`,
    visualDescription: `Visual for scene ${n}`,
    manimCode: code,
  });

  it('is empty for the first scene', () => {
    expect(buildSceneContext([])).toBe('');
  });

  it('surfaces what earlier scenes actually drew', () => {
    const block = buildSceneContext([entry(1, SORTING_SCENE)]);
    expect(block).toContain('[5, 2, 8, 1, 9]');
    expect(block).toContain('BLUE');
    expect(block).toContain('Already drawn on screen');
  });

  it('orders by scene number, not by arrival order', () => {
    // The batch pipeline finishes scenes out of order; a scrambled chronology
    // defeats the purpose of a lesson that builds in sequence.
    const block = buildSceneContext([entry(3), entry(1), entry(2)]);
    const positions = [1, 2, 3].map((n) => block.indexOf(`Scene ${n} —`));
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  });

  it('still lists a scene whose code was never generated', () => {
    const block = buildSceneContext([entry(1, null), entry(2, SORTING_SCENE)]);
    expect(block).toContain('Scene 1 —');
    expect(block).toContain('was not generated');
  });

  it('trims long text at a word boundary rather than mid-word', () => {
    const long: SceneContextEntry = {
      sceneNumber: 1,
      narration: 'alpha bravo charlie delta echo foxtrot golf hotel '.repeat(20),
      visualDescription: 'x',
      manimCode: null,
    };
    const narrationLine = buildSceneContext([long])
      .split('\n')
      .find((l) => l.includes('Narration:'))!;
    expect(narrationLine).toContain('…');
    // A word-boundary trim never leaves a partial word before the ellipsis.
    const beforeEllipsis = narrationLine.slice(0, narrationLine.indexOf('…'));
    const lastWord = beforeEllipsis.trim().split(' ').pop();
    expect(
      ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']
    ).toContain(lastWord);
  });

  it('stays compact as scenes accumulate', () => {
    // The block is prepended to every later scene's prompt, so unbounded
    // growth costs O(N^2) tokens across a storyboard.
    const entries = [1, 2, 3, 4, 5].map((n) => entry(n, SORTING_SCENE));
    expect(buildSceneContext(entries).length).toBeLessThan(4000);
  });
});
