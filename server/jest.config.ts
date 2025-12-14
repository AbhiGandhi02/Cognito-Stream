import { cleanupTestData, createTestStoryboard } from "./src/__tests__/utils.test";
import { prisma } from "./src/lib/prisma";

export const jestConfig = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
      '^.+\\.ts$': 'ts-jest',
    },
    collectCoverageFrom: [
      'src/**/*.ts',
      '!src/**/*.d.ts',
      '!src/**/*.test.ts',
      '!src/**/__tests__/**',
    ],
    coverageThreshold: {
      global: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },
    setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
    testTimeout: 30000,
  };
  
  // ==========================================
  // TEST SETUP
  // server/src/__tests__/setup.ts
  // ==========================================
  
  beforeAll(async () => {
    console.log('🧪 Setting up test environment...');
  });
  
  afterAll(async () => {
    console.log('🧹 Cleaning up test environment...');
    await cleanupTestData();
    await prisma.$disconnect();
  });
  
  export { createTestStoryboard, cleanupTestData };