// ==========================================
// GEMINI REQUEST PACING
// ==========================================
//
// Guards the property that matters: concurrent workers cannot burst past the
// per-minute budget. A burst returns 429, which the failover logic reads as a
// quota signal and uses to cool the key down — so over-permitting here costs
// far more than a short wait.

describe('acquireLLMSlot', () => {
  const OLD = process.env;
  beforeEach(() => { jest.resetModules(); process.env = { ...OLD }; });
  afterAll(() => { process.env = OLD; });

  it('admits up to the configured limit without waiting', async () => {
    process.env.GEMINI_RPM_PRIMARY = '5';
    const { acquireLLMSlot } = await import('../services/llmRateLimit');
    const started = Date.now();
    for (let i = 0; i < 5; i++) await acquireLLMSlot('primary');
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('serialises concurrent callers so they cannot all pass at once', async () => {
    process.env.GEMINI_RPM_PRIMARY = '3';
    const { acquireLLMSlot } = await import('../services/llmRateLimit');
    // Four workers racing for three slots: three proceed, the fourth must wait
    // out the window rather than slipping through.
    const admitted: number[] = [];
    const tasks = [0, 1, 2].map(async (i) => { await acquireLLMSlot('primary'); admitted.push(i); });
    await Promise.all(tasks);
    expect(admitted).toHaveLength(3);

    let fourthDone = false;
    void acquireLLMSlot('primary').then(() => { fourthDone = true; });
    await new Promise((r) => setTimeout(r, 150));
    expect(fourthDone).toBe(false);   // still paced, not admitted
  });

  it('keeps tiers independent — the keys are in different projects', async () => {
    process.env.GEMINI_RPM_PRIMARY = '1';
    process.env.GEMINI_RPM_SECONDARY = '1';
    const { acquireLLMSlot } = await import('../services/llmRateLimit');
    await acquireLLMSlot('primary');
    const started = Date.now();
    await acquireLLMSlot('secondary');   // must not be blocked by primary
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('falls back to GEMINI_RPM then to the default', async () => {
    process.env.GEMINI_RPM = '42';
    delete process.env.GEMINI_RPM_PRIMARY;
    delete process.env.GEMINI_RPM_SECONDARY;
    const { rateLimitStatus } = await import('../services/llmRateLimit');
    expect(rateLimitStatus()).toEqual({ primary: 42, secondary: 42 });

    jest.resetModules();
    delete process.env.GEMINI_RPM;
    delete process.env.GEMINI_RPM_DEFAULT;
    const fresh = await import('../services/llmRateLimit');
    // 5 = the quota this project was actually observed to have, not a guess.
    expect(fresh.rateLimitStatus()).toEqual({ primary: 5, secondary: 5 });
  });
});
