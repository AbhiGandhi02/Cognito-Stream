/**
 * Narration timing.
 *
 * Every duration in the pipeline is derived from how long the narration
 * actually takes to speak, rather than from a fixed constant. Before this
 * existed, every scene was told "you have ~5 seconds" regardless of whether
 * its voiceover ran 4 seconds or 25 — so long scenes rendered a short
 * animation and then sat frozen on their last frame while the narrator kept
 * talking, and short scenes had their animation truncated at the audio length.
 *
 * The real duration comes from measuring the generated MP3. This module is the
 * estimate used before that audio exists (at storyboard creation, and as the
 * fallback when TTS is unavailable).
 */

// Piper's default English voices land close to 150 words per minute.
// Deliberately matches the char-based fallback in elevenlabs.ts (~15 chars/s).
const WORDS_PER_SECOND = 2.5;

// Manim needs a beat to open, draw and settle. Below this a scene is on screen
// too briefly to read, however short its narration is.
const MIN_SECONDS = 4;

// A narration longer than this is a scene-planning failure, not a timing one.
// Capping here stops one runaway scene from demanding a multi-minute render.
const MAX_SECONDS = 60;

export function countWords(text: string): number {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Estimated seconds of speech for a piece of narration, clamped to the range
 * a scene can sensibly occupy. Rounded to whole seconds — the prompt reads
 * better with round numbers and sub-second precision is noise at this stage.
 */
export function estimateNarrationSeconds(text: string): number {
  const words = countWords(text);
  if (words === 0) return MIN_SECONDS;
  const raw = words / WORDS_PER_SECOND;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(raw)));
}

/**
 * The duration a scene's animation should be built for.
 *
 * Prefers the measured length of the rendered narration audio; falls back to
 * the word-count estimate when audio has not been generated yet. Clamped the
 * same way in both cases so a TTS glitch can never hand the code generator a
 * 0-second or 10-minute budget.
 */
export function resolveSceneDuration(
  narration: string,
  measuredAudioSeconds?: number | null
): number {
  if (
    typeof measuredAudioSeconds === 'number' &&
    Number.isFinite(measuredAudioSeconds) &&
    measuredAudioSeconds > 0
  ) {
    return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(measuredAudioSeconds)));
  }
  return estimateNarrationSeconds(narration);
}

export const NARRATION_TIMING_BOUNDS = { MIN_SECONDS, MAX_SECONDS, WORDS_PER_SECOND };
