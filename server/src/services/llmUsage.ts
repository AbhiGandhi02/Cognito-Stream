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

export interface CallUsage {
  model: string;
  tier: string;
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
  unpriced: Set<string>;
}

// ==========================================
// PER-RUN ACCUMULATION
// ==========================================

// AsyncLocalStorage rather than a module-level counter: scenes are generated
// with SCENE_CONCURRENCY workers in flight and several videos can overlap, so
// a shared mutable total would mix them together.
const runStore = new AsyncLocalStorage<RunTotals>();

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
  usage: GeminiUsageMetadata | undefined
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
    console.log(`   💰 [${tier}] ${model} | ${parts} | ${cost}`);

    const run = runStore.getStore();
    if (run) {
      run.calls += 1;
      run.inputTokens += inputTokens;
      run.outputTokens += outputTokens;
      run.thinkingTokens += thinkingTokens;
      run.cachedTokens += cachedTokens;
      if (costUsd === null) {
        run.unpriced.add(model);
      } else {
        run.costUsd += costUsd;
        run.costByTier[tier] = (run.costByTier[tier] ?? 0) + costUsd;
      }
    }

    return {
      model,
      tier,
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
  const totals: RunTotals = {
    label,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    costByTier: {},
    unpriced: new Set(),
  };

  try {
    return await runStore.run(totals, fn);
  } finally {
    // Printed even when the run throws — a failed video still cost money.
    logRunSummary(totals);
  }
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
