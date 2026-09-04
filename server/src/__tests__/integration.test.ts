// ==========================================
// INTEGRATION TESTS
// server/src/__tests__/integration.test.ts
// ==========================================

import request from 'supertest';
import app from '../index';

describe('Integration Tests - Full Video Generation Flow', () => {
    it('should complete full video generation workflow', async () => {
      // Step 1: Create storyboard
      const storyboardResponse = await request(app)
        .post('/api/storyboard')
        .send({ prompt: 'Brief video about Newton\'s laws' })
        .expect(201);
  
      const storyboardId = storyboardResponse.body.id;
      const sceneId = storyboardResponse.body.scenes[0].id;
  
      expect(storyboardId).toBeTruthy();
  
      // Step 2: Process first scene
      const processResponse = await request(app)
        .post(`/api/scene/${sceneId}/process`)
        .send({ quality: 'low' })
        .expect(200);
  
      expect(processResponse.body.status).toBe('completed');
      expect(processResponse.body.audioUrl).toBeTruthy();
      expect(processResponse.body.videoUrl).toBeTruthy();
  
      // Step 3: Verify storyboard status
      const storyboardCheck = await request(app)
        .get(`/api/storyboard/${storyboardId}`)
        .expect(200);
  
      expect(storyboardCheck.body.scenes[0].status).toBe('completed');
    }, 180000); // 3 minute timeout
  });