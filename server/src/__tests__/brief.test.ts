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
  scopeNote: 'Covers bubble sort only; other sorts are out of scope.',
  outline: [
    {
      covers: 'Define sorted',
      onScreen: 'the row [5, 2, 8, 1, 9] as five boxes',
      changesFromPrevious: 'everything appears from nothing',
      keyMoment: 'the disorder is visible at a glance',
    },
    {
      covers: 'Compare and swap',
      onScreen: 'the same row, first adjacent pair outlined YELLOW',
      changesFromPrevious: 'row is re-drawn identically; the highlight is new',
      keyMoment: '5 and 2 trade places',
    },
    {
      covers: 'Repeat until done',
      onScreen: 'the row mid-sort, largest value at the right end',
      changesFromPrevious: 'the highlight sweeps left to right again',
      keyMoment: '9 reaches its final position',
    },
  ],
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

  it('numbers the beats so teaching order survives', () => {
    const out = formatBrief(BRIEF);
    expect(out).toContain('1. Define sorted');
    expect(out).toContain('3. Repeat until done');
  });

  it('carries each beat\u2019s on-screen, changes and notice lines', () => {
    // These are the whole point of the beat sheet: without them the planner
    // invents the visual specifics per scene, independently, which is how
    // consecutive scenes end up looking unrelated.
    const out = formatBrief(BRIEF);
    expect(out).toContain('the row [5, 2, 8, 1, 9] as five boxes');
    expect(out).toContain('row is re-drawn identically; the highlight is new');
    expect(out).toContain('9 reaches its final position');
  });

  it('states the scene count so the planner does not re-derive it', () => {
    expect(formatBrief(BRIEF)).toContain('3 scenes');
  });

  it('lists key terms for consistent notation', () => {
    expect(formatBrief(BRIEF)).toContain('pass, swap, adjacent pair');
  });

  it('omits empty sections rather than emitting bare headings', () => {
    const out = formatBrief({ ...BRIEF, keyTerms: [], outline: [] });
    expect(out).not.toContain('Key terms');
    expect(out).not.toContain('Beat sheet');
    // The part that matters is still there.
    expect(out).toContain('[5, 2, 8, 1, 9]');
  });
});

// ==========================================
// STORED BRIEF -> RETRY CONTEXT
// ==========================================
//
// The brief is persisted so a scene regenerated long after planning still knows
// which example the rest of the video was built around. Before this it was
// discarded after planning, and a retry could only infer the example from its
// own visualDescription.

import { briefContextFromJson } from '../services/gemini';

describe('briefContextFromJson', () => {
  it('re-states the video-level agreement a lone scene would otherwise lose', () => {
    const out = briefContextFromJson(JSON.stringify(BRIEF));
    expect(out).toContain('[5, 2, 8, 1, 9]');
    expect(out).toContain('use these exact values');
    expect(out).toContain('pass, swap, adjacent pair');
  });

  it('omits the beat sheet — the scene already has its own description', () => {
    const out = briefContextFromJson(JSON.stringify(BRIEF));
    expect(out).not.toContain('Beat sheet');
    expect(out).not.toContain('Define sorted');
  });

  it('carries the scope note so a retry cannot wander outside it', () => {
    const withScope = { ...BRIEF, scopeNote: 'Covers bubble sort only.' };
    expect(briefContextFromJson(JSON.stringify(withScope))).toContain('Covers bubble sort only.');
  });

  it('degrades to empty for storyboards predating the column, and for junk', () => {
    // Must not throw: rows created before the migration have NULL here.
    expect(briefContextFromJson(null)).toBe('');
    expect(briefContextFromJson(undefined)).toBe('');
    expect(briefContextFromJson('')).toBe('');
    expect(briefContextFromJson('{not json')).toBe('');
  });
});
