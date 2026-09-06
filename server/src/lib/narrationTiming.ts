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

// Measured, not assumed. 18 narrations of 6-45 words were synthesised through
// the configured Piper voice (en_GB-jenny_dioco-medium) and probed with ffprobe;
// least-squares over those samples gives 2.91 words/second, i.e. ~175 wpm — not
// the ~150 wpm this previously assumed. The old 2.5 over-estimated every scene
// in the 30-70 word band the planner produces by ~21% on average, so each
// animation was built to outlast its narration and ended on 2-3s of silence
// that ffmpeg padded in.
//
// An affine model (fixed per-clip overhead + a rate) was tried and rejected:
// on 18 samples the intercept collapses to 0.34s and a pure rate fits better
// (max error 16.6% vs 20.0%).
//
// VOICE-SPECIFIC. Re-measure if PIPER_VOICE changes.
//
// Residual error is ~16% at worst and is irreducible from word count alone —
// two 45-word narrations in the sample measured 14.55s and 17.29s, because
// punctuation and phrasing drive pauses. Only measuring the real audio before
// generating the animation removes that; see resolveSceneDuration below.
const WORDS_PER_SECOND = 2.9;

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
