// ==========================================
// SCENE ROUTES TESTS
// server/src/__tests__/scene.test.ts
// ==========================================

import request from 'supertest';
import app from '../index';

describe('Scene Routes', () => {
    let sceneId: string;
    let storyboardId: string;
  
    beforeAll(async () => {
      // Create a test storyboard
      const response = await request(app)
        .post('/api/storyboard')
        .send({ prompt: 'Test storyboard for scene tests' });
  
      storyboardId = response.body.id;
      sceneId = response.body.scenes[0].id;
    });
  
    describe('GET /api/scene/:id', () => {
      it('should retrieve a scene by ID', async () => {
        const response = await request(app)
          .get(`/api/scene/${sceneId}`)
          .expect(200);
  
        expect(response.body.id).toBe(sceneId);
        expect(response.body).toHaveProperty('narration');
        expect(response.body).toHaveProperty('manimCode');
      });
    });
  
    describe('PATCH /api/scene/:id', () => {
      it('should update scene narration', async () => {
        const updatedNarration = 'Updated narration text';
  
        const response = await request(app)
          .patch(`/api/scene/${sceneId}`)
          .send({ narration: updatedNarration })
          .expect(200);
  
        expect(response.body.narration).toBe(updatedNarration);
        expect(response.body.status).toBe('pending');
      });
  
      it('should update Manim code', async () => {
        const updatedCode = ['Text("Updated").scale(2)'];
  
        const response = await request(app)
          .patch(`/api/scene/${sceneId}`)
          .send({ manimCode: updatedCode })
          .expect(200);
  
        expect(response.body.manimCode).toEqual(updatedCode);
      });
    });
  });