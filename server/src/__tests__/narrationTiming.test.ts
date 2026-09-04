// ==========================================
// NARRATION TIMING TESTS
// ==========================================
//
// These guard the timing budget that the animation is built to fit. Before it
// existed, every scene was told "~5 seconds" regardless of its script, so long
// narrations rendered a short animation followed by a frozen frame.

import {
  countWords,
  estimateNarrationSeconds,
  resolveSceneDuration,
  NARRATION_TIMING_BOUNDS,
} from '../lib/narrationTiming';

const { MIN_SECONDS, MAX_SECONDS, WORDS_PER_SECOND } = NARRATION_TIMING_BOUNDS;

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('bubble sort compares adjacent pairs')).toBe(5);
  });

  it('is not fooled by irregular whitespace', () => {
    expect(countWords('  two\n\nwords\t ')).toBe(2);
  });

  it('treats empty and whitespace-only text as zero', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});

describe('estimateNarrationSeconds', () => {
  it('scales with narration length at the speaking rate', () => {
    const words = 50;
    const seconds = estimateNarrationSeconds('word '.repeat(words));
    expect(seconds).toBe(Math.round(words / WORDS_PER_SECOND));
  });

  it('gives a longer budget to a longer script', () => {
    const short = estimateNarrationSeconds('word '.repeat(20));
    const long = estimateNarrationSeconds('word '.repeat(80));
    expect(long).toBeGreaterThan(short);
  });

  it('floors short narrations so a scene is on screen long enough to read', () => {
    expect(estimateNarrationSeconds('Sorting orders things.')).toBe(MIN_SECONDS);
    expect(estimateNarrationSeconds('')).toBe(MIN_SECONDS);
  });

  it('caps a runaway narration rather than demanding a multi-minute render', () => {
    expect(estimateNarrationSeconds('word '.repeat(5000))).toBe(MAX_SECONDS);
  });

  it('always returns a positive whole number of seconds', () => {
    for (const n of [0, 1, 7, 40, 200, 5000]) {
      const seconds = estimateNarrationSeconds('word '.repeat(n));
      expect(Number.isInteger(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
    }
  });
});

describe('resolveSceneDuration', () => {
  const narration = 'word '.repeat(50); // ~20s estimated

  it('prefers measured audio over the word-count estimate', () => {
    expect(resolveSceneDuration(narration, 26.4)).toBe(26);
    expect(resolveSceneDuration(narration, 26.4)).not.toBe(
      estimateNarrationSeconds(narration)
    );
  });

  it('falls back to the estimate when audio is missing or unusable', () => {
    const expected = estimateNarrationSeconds(narration);
    for (const bad of [undefined, null, 0, -5, NaN, Infinity]) {
      expect(resolveSceneDuration(narration, bad as number)).toBe(expected);
    }
  });

  it('clamps a measured duration the same way as an estimate', () => {
    expect(resolveSceneDuration(narration, 0.4)).toBe(MIN_SECONDS);
    expect(resolveSceneDuration(narration, 9999)).toBe(MAX_SECONDS);
  });

  it('never hands the code generator a fractional budget', () => {
    expect(Number.isInteger(resolveSceneDuration(narration, 12.7))).toBe(true);
  });
});
