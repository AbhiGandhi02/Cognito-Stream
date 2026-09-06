// ==========================================
// RETRY ACCOUNTING
// ==========================================
//
// A retry is remedial spend, not part of what a video costs to produce.
// Folding it into the per-video total would make the videos that went WRONG
// report the highest price-to-generate, which inverts the meaning of the
// reference figure. It must still be logged in full.

import { recordUsage, withVideoCost, assignVideoCost, logVideoCost, withRetryCost } from '../services/llmUsage';

const usage = (i: number, o: number, t: number) => ({
  promptTokenCount: i, candidatesTokenCount: o, thoughtsTokenCount: t, cachedContentTokenCount: 0,
});
const M = 'gemini-3.7-flash';

function capture(fn: () => Promise<void>) {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
  return fn().finally(() => { console.log = orig; }).then(() => lines);
}

describe('retry cost is reported but not charged to the video', () => {
  it('excludes retry spend from the video total and logs it separately', async () => {
    const id = 'sbRetry1';
    const lines = await capture(async () => {
      await withVideoCost(null, async () => {
        recordUsage(M, 'primary', usage(900, 1400, 1200), 'plan');
        assignVideoCost(id);
      });
      await withVideoCost(id, async () => { recordUsage(M, 'primary', usage(8255, 1700, 3000), 'code'); });
      logVideoCost(id, { title: 'Ohms Law', scenes: 1, durationSec: 20 });

      // A retry AFTER the video shipped.
      await withRetryCost(id, 2, async () => {
        recordUsage(M, 'primary', usage(8255, 1700, 3000), 'code');
        recordUsage(M, 'primary', usage(9200, 1750, 2600), 'repair');
      });
    });

    const video = lines.find((l) => l.includes('TOTAL LLM COST'))!;
    const retry = lines.find((l) => l.includes('RETRY COST'))!;
    expect(video).toBeDefined();
    expect(retry).toBeDefined();
    expect(retry).toContain('EXCLUDED from the');

    // The video's figure must be the pre-retry one: plan + one code call.
    const money = (s: string) => Number(s.match(/₹([\d.]+)/)![1]);
    expect(money(video)).toBeGreaterThan(0);
    expect(money(retry)).toBeGreaterThan(money(video)); // 2 calls vs the video's cheaper pair
    // And the video block must have been emitted BEFORE the retry block.
    expect(lines.indexOf(video)).toBeLessThan(lines.indexOf(retry));
  });

  it('a second retry does not resurrect or mutate the video total', async () => {
    const id = 'sbRetry2';
    const lines = await capture(async () => {
      await withVideoCost(id, async () => { recordUsage(M, 'primary', usage(8000, 1500, 2000), 'code'); });
      logVideoCost(id, { title: 'V', scenes: 1 });
      await withRetryCost(id, 3, async () => { recordUsage(M, 'primary', usage(8000, 1500, 2000), 'code'); });
      logVideoCost(id, { title: 'V', scenes: 1 });   // must print nothing
    });
    expect(lines.filter((l) => l.includes('TOTAL LLM COST'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('RETRY COST'))).toHaveLength(1);
  });

  it('reports zero-cost retries silently rather than printing an empty block', async () => {
    const lines = await capture(async () => {
      await withRetryCost('sbRetry3', 1, async () => { /* no LLM calls */ });
    });
    expect(lines.filter((l) => l.includes('RETRY COST'))).toHaveLength(0);
  });
});
