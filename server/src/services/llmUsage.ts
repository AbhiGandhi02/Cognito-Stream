// ==========================================
// LLM TOKEN + COST ACCOUNTING
// server/src/services/llmUsage.ts
// ==========================================
//
// Every Gemini response carries a usageMetadata block with exact token counts.
// We were discarding it. This module records it per call, prices it, and
// (optionally) totals it per video so the real cost is visible in the logs
// instead of estimated after the fact.
//
// Also surfaces cachedContentTokenCount — the only way to tell whether Gemini's
// implicit caching is actually engaging on the ~4.8k-token system prompt we
// resend on every scene.

import { AsyncLocalStorage } from 'node:async_hooks';

// ==========================================
// PRICING
// ==========================================

interface ModelPrice {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens (thinking bills as output)
  cached: number; // USD per 1M cached input tokens
}

// USD per 1M tokens. Keep in sync with ai.google.dev/gemini-api/docs/pricing.
// NOTE: gemini-3.7-flash is on introductory pricing until 2026-12-31, after
// which input/output/cached double to 1.50 / 7.50 / 0.15.
const PRICING: Record<string, ModelPrice> = {
  'gemini-3.7-flash': { input: 0.75, output: 3.75, cached: 0.075 },
  'gemini-3.6-flash': { input: 1.5, output: 7.5, cached: 0.15 },
  'gemini-3.5-flash': { input: 1.5, output: 9.0, cached: 0.15 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cached: 0.03 },
  'gemini-3.1-pro-preview': { input: 2.0, output: 12.0, cached: 0.2 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cached: 0.03 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cached: 0.01 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0, cached: 0.125 },
};

// Only used to render a familiar number in the logs; the USD figure is the
// source of truth. Override with USD_INR if the rate drifts.
const USD_INR = Number(process.env.USD_INR) || 88.2;

function priceFor(model: string): ModelPrice | null {
  if (PRICING[model]) return PRICING[model];
  // Tolerate dated/preview suffixes like 'gemini-2.5-flash-preview-09-2026'.
  const match = Object.keys(PRICING).find((known) => model.startsWith(known));
  return match ? PRICING[match] : null;
}

// ==========================================
// TYPES
// ==========================================

/** The shape @google/generative-ai returns on response.usageMetadata. */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
}

/** Which part of the pipeline spent the money. */
export type UsageStage = 'brief' | 'plan' | 'code' | 'repair' | 'other';

export interface CallUsage {
  model: string;
  tier: string;
  stage: UsageStage;
  inputTokens: number;
  outputTokens: number; // visible output only
  thinkingTokens: number;
  cachedTokens: number;
  costUsd: number | null; // null when the model has no pricing entry
}

interface RunTotals {
  label: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedTokens: number;
  costUsd: number;
  costByTier: Record<string, number>;
  /** Per-pipeline-stage split, so the expensive stage is visible at a glance. */
  byStage: Record<string, { calls: number; costUsd: number; tokens: number }>;
  unpriced: Set<string>;
  startedAt: number;
}

function newTotals(label: string): RunTotals {
  return {
    label,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    costByTier: {},
    byStage: {},
    unpriced: new Set(),
    startedAt: Date.now(),
  };
}

function mergeTotals(into: RunTotals, from: RunTotals): void {
  into.calls += from.calls;
  into.inputTokens += from.inputTokens;
  into.outputTokens += from.outputTokens;
  into.thinkingTokens += from.thinkingTokens;
  into.cachedTokens += from.cachedTokens;
  into.costUsd += from.costUsd;
  into.startedAt = Math.min(into.startedAt, from.startedAt);
  for (const [tier, usd] of Object.entries(from.costByTier)) {
    into.costByTier[tier] = (into.costByTier[tier] ?? 0) + usd;
  }
  for (const [stage, v] of Object.entries(from.byStage)) {
    const t = (into.byStage[stage] ??= { calls: 0, costUsd: 0, tokens: 0 });
    t.calls += v.calls; t.costUsd += v.costUsd; t.tokens += v.tokens;
  }
  from.unpriced.forEach((m) => into.unpriced.add(m));
}

// ==========================================
// PER-RUN ACCUMULATION
// ==========================================

// AsyncLocalStorage rather than a module-level counter: scenes are generated
// with SCENE_CONCURRENCY workers in flight and several videos can overlap, so
// a shared mutable total would mix them together.
const runStore = new AsyncLocalStorage<{ totals: RunTotals; key: string | null }>();

// ==========================================
// PER-VIDEO TOTALS (ACROSS REQUESTS)
// ==========================================
//
// One video's LLM spend is NOT one async call tree. In the live flow the user
// clicks "Generate Code", which fires one HTTP request per scene, and only
// later clicks "Render Final Video". AsyncLocalStorage cannot span those, so
// the old per-run summary reported only whatever happened inside a single
// request — for the two-step UI that meant the render phase's repair calls and
// none of the N code-generation calls that dominate the bill.
//
// This map accumulates by storyboard id until the final video is assembled.
const videoTotals = new Map<string, RunTotals>();

// Abandoned drafts would otherwise accumulate forever. Bounded, oldest-first.
const MAX_TRACKED_VIDEOS = 300;

function trackedTotals(key: string): RunTotals {
  let t = videoTotals.get(key);
  if (!t) {
    t = newTotals(`video ${key}`);
    if (videoTotals.size >= MAX_TRACKED_VIDEOS) {
      const oldest = videoTotals.keys().next().value;
      if (oldest) videoTotals.delete(oldest);
    }
    videoTotals.set(key, t);
  }
  return t;
}

function fmtUsd(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(4)}`;
}

function fmtInr(usd: number): string {
  return `₹${(usd * USD_INR).toFixed(2)}`;
}

function fmtTokens(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Price and log a single LLM call, and fold it into the active run if there
 * is one. Never throws — accounting must not be able to fail a generation.
 */
export function recordUsage(
  model: string,
  tier: string,
  usage: GeminiUsageMetadata | undefined,
  stage: UsageStage = 'other'
): CallUsage | null {
  try {
    if (!usage) return null;

    const cachedTokens = usage.cachedContentTokenCount ?? 0;
    const inputTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;
    const thinkingTokens = usage.thoughtsTokenCount ?? 0;

    const price = priceFor(model);
    let costUsd: number | null = null;
    if (price) {
      // Cached tokens are reported inside promptTokenCount, so bill the
      // uncached remainder at full rate and the cached part at the discount.
      const freshInput = Math.max(0, inputTokens - cachedTokens);
      costUsd =
        (freshInput * price.input +
          cachedTokens * price.cached +
          // Thinking tokens bill as output and are NOT included in
          // candidatesTokenCount, so they must be added, not assumed.
          (outputTokens + thinkingTokens) * price.output) /
        1e6;
    }

    const parts = [
      `in ${fmtTokens(inputTokens)}`,
      `out ${fmtTokens(outputTokens)}`,
      `think ${fmtTokens(thinkingTokens)}`,
      `cached ${fmtTokens(cachedTokens)}`,
    ].join(' · ');
    const cost =
      costUsd === null ? 'cost n/a (unpriced model)' : `${fmtInr(costUsd)} (${fmtUsd(costUsd)})`;
    console.log(`   💰 [${stage}/${tier}] ${model} | ${parts} | ${cost}`);

    const run = runStore.getStore()?.totals;
    if (run) {
      run.calls += 1;
      run.inputTokens += inputTokens;
      run.outputTokens += outputTokens;
      run.thinkingTokens += thinkingTokens;
      run.cachedTokens += cachedTokens;
      const st = (run.byStage[stage] ??= { calls: 0, costUsd: 0, tokens: 0 });
      st.calls += 1;
      st.tokens += inputTokens + outputTokens + thinkingTokens;
      if (costUsd === null) {
        run.unpriced.add(model);
      } else {
        run.costUsd += costUsd;
        run.costByTier[tier] = (run.costByTier[tier] ?? 0) + costUsd;
        st.costUsd += costUsd;
      }
    }

    return {
      model,
      tier,
      stage,
      inputTokens,
      outputTokens,
      thinkingTokens,
      cachedTokens,
      costUsd,
    };
  } catch {
    // Accounting is strictly observational — swallow anything it throws.
    return null;
  }
}

/**
 * Run `fn` with a fresh usage tally and print a summary when it settles.
 * Wrap one video generation in this to get a per-video total.
 */
export async function withUsageRun<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const totals = newTotals(label);
  try {
    return await runStore.run({ totals, key: null }, fn);
  } finally {
    // Printed even when the run throws — a failed video still cost money.
    logRunSummary(totals);
  }
}

/**
 * Accumulate every LLM call inside `fn` against one video, across however many
 * HTTP requests that video takes. Safe to nest and safe to call repeatedly for
 * the same id — a storyboard's twelve "Generate Code" requests and its later
 * render all fold into one running total.
 *
 * Nothing is printed here; the total is emitted once by `logVideoCost` when
 * the final video is assembled.
 */
export async function withVideoCost<T>(
  storyboardId: string | null,
  fn: () => Promise<T>
): Promise<T> {
  // A null id still opens a scope: the brief and the scene plan are generated
  // before the storyboard row exists, and `assignVideoCost` adopts that scope
  // once the id is known. Returning fn() bare here would silently drop them.
  const totals = storyboardId ? trackedTotals(storyboardId) : newTotals('pending video');
  return runStore.run({ totals, key: storyboardId }, fn);
}

/**
 * Account for a manual scene retry SEPARATELY from the video's own cost.
 *
 * A retry is remedial spend, not part of what a video costs to make. Folding it
 * into the per-video total would mean the videos that went wrong report the
 * highest "price to generate", which is exactly backwards for a reference
 * figure — a scene retried four times would triple the apparent cost of the
 * product.
 *
 * So it gets its own tally under its own key, is reported in full with the same
 * token and money breakdown, and never touches `videoTotals[storyboardId]`.
 * The video's reference price was already emitted when its final cut was first
 * assembled.
 */
export async function withRetryCost<T>(
  storyboardId: string,
  sceneNumber: number,
  fn: () => Promise<T>
): Promise<T> {
  const key = `retry:${storyboardId}:${sceneNumber}:${Date.now()}`;
  const totals = newTotals(`retry scene ${sceneNumber}`);
  videoTotals.set(key, totals);
  try {
    return await runStore.run({ totals, key }, fn);
  } finally {
    videoTotals.delete(key);
    logRetrySummary(storyboardId, sceneNumber, totals);
  }
}

function logRetrySummary(storyboardId: string, sceneNumber: number, t: RunTotals): void {
  if (t.calls === 0) return;
  const wall = ((Date.now() - t.startedAt) / 1000).toFixed(0);
  const line = '─'.repeat(64);
  console.log(`\n   ${line}`);
  console.log(`   🔁 SCENE RETRY — scene ${sceneNumber} of ${storyboardId}`);
  console.log(
    `   tokens        in ${fmtTokens(t.inputTokens)} · out ${fmtTokens(t.outputTokens)} · ` +
    `thinking ${fmtTokens(t.thinkingTokens)} · cached ${fmtTokens(t.cachedTokens)}`
  );
  for (const [stage, v] of Object.entries(t.byStage).sort((a, b) => b[1].costUsd - a[1].costUsd)) {
    console.log(
      `   ${stage.padEnd(13)} ${String(v.calls).padStart(2)} call(s) · ` +
      `${fmtTokens(v.tokens).padStart(8)} tok · ${fmtInr(v.costUsd).padStart(9)}`
    );
  }
  console.log(
    `   💰 RETRY COST  ${fmtInr(t.costUsd)} (${fmtUsd(t.costUsd)}) · ${wall}s` +
    `   — EXCLUDED from the video's reference price`
  );
  console.log(`   ${line}\n`);
}

/**
 * Attach the running scope to a storyboard id that did not exist when the
 * scope opened. Needed because the brief and the scene plan are generated
 * BEFORE the storyboard row is created, so their cost has nowhere to go yet.
 */
export function assignVideoCost(storyboardId: string): void {
  const store = runStore.getStore();
  if (!store || store.key) return;
  const target = trackedTotals(storyboardId);
  mergeTotals(target, store.totals);
  store.totals = target;
  store.key = storyboardId;
}

/**
 * Emit the final per-video cost and stop tracking it. Called once the final
 * video exists, which is the only moment the number is actually complete.
 */
export function logVideoCost(
  storyboardId: string,
  meta?: { title?: string; scenes?: number; durationSec?: number | null }
): void {
  const t = videoTotals.get(storyboardId);
  videoTotals.delete(storyboardId);
  if (!t || t.calls === 0) return;

  const wall = ((Date.now() - t.startedAt) / 1000).toFixed(0);
  const perScene = meta?.scenes ? t.costUsd / meta.scenes : null;
  const line = '═'.repeat(64);

  console.log(`\n   ${line}`);
  console.log(`   🎬 VIDEO COMPLETE — ${meta?.title || storyboardId}`);
  console.log(`   ${line}`);
  if (meta?.scenes) {
    console.log(
      `   scenes        ${meta.scenes}` +
      (meta.durationSec ? `  ·  runtime ${meta.durationSec.toFixed(1)}s` : '') +
      `  ·  wall clock ${wall}s`
    );
  }
  console.log(
    `   tokens        in ${fmtTokens(t.inputTokens)} · out ${fmtTokens(t.outputTokens)} · ` +
    `thinking ${fmtTokens(t.thinkingTokens)} · cached ${fmtTokens(t.cachedTokens)}`
  );
  for (const [stage, v] of Object.entries(t.byStage).sort((a, b) => b[1].costUsd - a[1].costUsd)) {
    const share = t.costUsd > 0 ? `${((v.costUsd / t.costUsd) * 100).toFixed(0)}%` : '—';
    console.log(
      `   ${stage.padEnd(13)} ${String(v.calls).padStart(2)} call(s) · ` +
      `${fmtTokens(v.tokens).padStart(8)} tok · ${fmtInr(v.costUsd).padStart(9)} (${share})`
    );
  }
  console.log(`   ${'─'.repeat(64)}`);
  console.log(
    `   💰 TOTAL LLM COST  ${fmtInr(t.costUsd)}  (${fmtUsd(t.costUsd)})` +
    (perScene !== null ? `   ·   ${fmtInr(perScene)}/scene` : '')
  );
  console.log(`   (TTS and Manim rendering are self-hosted — no per-video charge.)`);
  if (t.cachedTokens === 0 && t.inputTokens > 0) {
    console.log(
      `   💡 0 cached tokens across the whole video — the system prompt is being ` +
      `billed at full rate on every scene.`
    );
  }
  if (t.unpriced.size > 0) {
    console.log(`   ⚠️  excludes unpriced model(s): ${[...t.unpriced].join(', ')}`);
  }
  console.log(`   ${line}\n`);
}

function logRunSummary(t: RunTotals): void {
  if (t.calls === 0) return;

  const tierSplit = Object.entries(t.costByTier)
    .map(([tier, usd]) => `${tier} ${fmtInr(usd)}`)
    .join(' / ');

  console.log('   ' + '─'.repeat(62));
  console.log(
    `   💰 ${t.label}: ${t.calls} calls · in ${fmtTokens(t.inputTokens)} · ` +
      `out ${fmtTokens(t.outputTokens)} · think ${fmtTokens(t.thinkingTokens)} · ` +
      `cached ${fmtTokens(t.cachedTokens)}`
  );
  console.log(
    `   💰 ${t.label}: ${fmtInr(t.costUsd)} (${fmtUsd(t.costUsd)})` +
      (tierSplit ? `  —  ${tierSplit}` : '')
  );
  if (t.cachedTokens === 0 && t.inputTokens > 0) {
    console.log(
      `   💡 0 cached tokens — implicit caching is not engaging; the system ` +
        `prompt is being billed at full rate on every call.`
    );
  }
  if (t.unpriced.size > 0) {
    console.log(
      `   ⚠️  cost excludes unpriced model(s): ${[...t.unpriced].join(', ')} ` +
        `— add them to PRICING in llmUsage.ts`
    );
  }
  console.log('   ' + '─'.repeat(62));
}
