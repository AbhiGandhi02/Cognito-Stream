// ==========================================
// VIDEO BRIEF TESTS
// ==========================================
//
// The brief decides the worked example ONCE, before planning, so every scene
// inherits the same concrete data — including scene 1, which has no earlier
// scenes to copy from. formatBrief is what the planner actually reads.

import { formatBrief, type VideoBrief } from '../services/gemini';

const BRIEF: VideoBrief = {
  title: 'Visualizing Bubble Sort',
  summary: 'How bubble sort orders elements by comparing adjacent pairs.',
  workedExample: 'bubble-sorting a five-element array of small integers',
  exampleData: '[5, 2, 8, 1, 9]',
  keyTerms: ['pass', 'swap', 'adjacent pair'],
  outline: ['Define sorted', 'Compare and swap', 'Repeat until done'],
};

describe('formatBrief', () => {
  it('puts the literal example data in front of the planner', () => {
    const out = formatBrief(BRIEF);
    expect(out).toContain('[5, 2, 8, 1, 9]');
    // Labelled imperatively — a bare value reads as a suggestion.
    expect(out).toContain('use these exact values');
  });

  it('includes title, goal and worked example', () => {
    const out = formatBrief(BRIEF);
    expect(out).toContain('Visualizing Bubble Sort');
    expect(out).toContain(BRIEF.summary);
    expect(out).toContain(BRIEF.workedExample);
  });

  it('numbers the outline so teaching order survives', () => {
    const out = formatBrief(BRIEF);
    expect(out).toContain('1. Define sorted');
    expect(out).toContain('3. Repeat until done');
  });

  it('lists key terms for consistent notation', () => {
    expect(formatBrief(BRIEF)).toContain('pass, swap, adjacent pair');
  });

  it('omits empty sections rather than emitting bare headings', () => {
    const out = formatBrief({ ...BRIEF, keyTerms: [], outline: [] });
    expect(out).not.toContain('Key terms');
    expect(out).not.toContain('Cover, in this order');
    // The part that matters is still there.
    expect(out).toContain('[5, 2, 8, 1, 9]');
  });
});
