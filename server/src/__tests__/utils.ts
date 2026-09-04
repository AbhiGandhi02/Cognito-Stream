// ==========================================
// TEST UTILITIES
// server/src/__tests__/utils.ts
// ==========================================

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

export async function createTestStoryboard(prompt?: string) {
    const response = await request(app)
      .post('/api/storyboard')
      .send({ prompt: prompt || 'Test storyboard' });
  
    return response.body;
  }
  
  export async function cleanupTestData() {
    // Clean up test storyboards
    await prisma.storyboard.deleteMany({
      where: {
        prompt: {
          contains: 'test',
        },
      },
    });
  }