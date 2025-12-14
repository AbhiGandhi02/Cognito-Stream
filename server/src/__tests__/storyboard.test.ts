// ==========================================
// STORYBOARD ROUTES TESTS
// server/src/__tests__/storyboard.test.ts
// ==========================================

import * as request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

describe('Storyboard Routes', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/storyboard', () => {
    it('should create a new storyboard', async () => {
      const response = await request(app)
        .post('/api/storyboard')
        .send({
          prompt: 'Create an educational video about the solar system',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('title');
      expect(response.body).toHaveProperty('scenes');
      expect(Array.isArray(response.body.scenes)).toBe(true);
      expect(response.body.scenes.length).toBeGreaterThan(0);
    });

    it('should reject prompt that is too short', async () => {
      const response = await request(app)
        .post('/api/storyboard')
        .send({
          prompt: 'short',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should reject empty prompt', async () => {
      await request(app)
        .post('/api/storyboard')
        .send({})
        .expect(400);
    });
  });

  describe('GET /api/storyboard/:id', () => {
    let storyboardId: string;

    beforeAll(async () => {
      const response = await request(app)
        .post('/api/storyboard')
        .send({ prompt: 'Test storyboard for GET endpoint' });

      storyboardId = response.body.id;
    });

    it('should retrieve a storyboard by ID', async () => {
      const response = await request(app)
        .get(`/api/storyboard/${storyboardId}`)
        .expect(200);

      expect(response.body.id).toBe(storyboardId);
      expect(response.body).toHaveProperty('scenes');
    });

    it('should return 404 for non-existent storyboard', async () => {
      await request(app)
        .get('/api/storyboard/non-existent-id')
        .expect(404);
    });
  });

  describe('GET /api/storyboard', () => {
    it('should list storyboards with pagination', async () => {
      const response = await request(app)
        .get('/api/storyboard')
        .query({ limit: 10, offset: 0 })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });
});