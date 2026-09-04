// ==========================================
// JEST SETUP — runs once per test file
// ==========================================
//
// This lived inside jest.config.ts, where its beforeAll/afterAll calls ran at
// config-parse time (before Jest defines those globals) and crashed the runner.
//
// It deliberately does NOT import ./utils, which pulls in src/index.ts — the
// whole Express app — for every suite. That made a pure unit test transitively
// depend on the auth middleware, and through it on jose, which is ESM-only and
// unloadable under this CJS Jest setup. Suites that need the app import it
// themselves.

import { prisma } from '../lib/prisma';

afterAll(async () => {
  await prisma.$disconnect().catch(() => { /* never fail teardown */ });
});
