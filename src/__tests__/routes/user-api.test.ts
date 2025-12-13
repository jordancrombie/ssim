import express from 'express';
import request from 'supertest';
import userApiRoutes from '../../routes/user-api';
import { createMockSession } from '../mocks/mockSession';

// Mock the store service
jest.mock('../../services/store', () => ({
  updateWsimJwt: jest.fn().mockResolvedValue({ id: 'user-123' }),
  clearWsimJwt: jest.fn().mockResolvedValue({}),
}));

import { updateWsimJwt, clearWsimJwt } from '../../services/store';

// Create test app
const createTestApp = (sessionData: any = {}) => {
  const app = express();
  app.use(express.json());

  // Mock session middleware
  app.use((req, res, next) => {
    req.session = createMockSession(sessionData) as any;
    next();
  });

  app.use('/api/user', userApiRoutes);
  return app;
};

describe('User API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/user/wsim-token', () => {
    it('should return persisted: false when no storeUserId in session', async () => {
      const app = createTestApp({});
      const response = await request(app)
        .post('/api/user/wsim-token')
        .send({ token: 'jwt-token', expiresIn: 3600 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.persisted).toBe(false);
      expect(response.body.reason).toBe('no_user_session');
    });

    it('should return 400 when token is missing', async () => {
      const app = createTestApp({ storeUserId: 'user-123' });
      const response = await request(app)
        .post('/api/user/wsim-token')
        .send({ expiresIn: 3600 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing token or expiresIn');
    });

    it('should return 400 when expiresIn is missing', async () => {
      const app = createTestApp({ storeUserId: 'user-123' });
      const response = await request(app)
        .post('/api/user/wsim-token')
        .send({ token: 'jwt-token' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing token or expiresIn');
    });

    it('should persist token successfully when user is logged in', async () => {
      const app = createTestApp({ storeUserId: 'user-123' });
      const response = await request(app)
        .post('/api/user/wsim-token')
        .send({ token: 'jwt-token', expiresIn: 3600 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.persisted).toBe(true);
      expect(updateWsimJwt).toHaveBeenCalledWith(
        'user-123',
        'jwt-token',
        expect.any(Date)
      );
    });

    it('should handle database errors gracefully', async () => {
      (updateWsimJwt as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

      const app = createTestApp({ storeUserId: 'user-123' });
      const response = await request(app)
        .post('/api/user/wsim-token')
        .send({ token: 'jwt-token', expiresIn: 3600 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.persisted).toBe(false);
      expect(response.body.reason).toBe('db_error');
    });
  });

  describe('DELETE /api/user/wsim-token', () => {
    it('should return success when no storeUserId in session', async () => {
      const app = createTestApp({});
      const response = await request(app).delete('/api/user/wsim-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(clearWsimJwt).not.toHaveBeenCalled();
    });

    it('should clear token successfully when user is logged in', async () => {
      const app = createTestApp({
        storeUserId: 'user-123',
        wsimJwt: 'old-token',
        wsimJwtExp: Date.now() + 3600000,
      });
      const response = await request(app).delete('/api/user/wsim-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(clearWsimJwt).toHaveBeenCalledWith('user-123');
    });

    it('should handle database errors', async () => {
      (clearWsimJwt as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

      const app = createTestApp({ storeUserId: 'user-123' });
      const response = await request(app).delete('/api/user/wsim-token');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to clear token');
    });
  });

  describe('GET /api/user/wsim-token', () => {
    it('should return hasToken: false when no token in session', async () => {
      const app = createTestApp({});
      const response = await request(app).get('/api/user/wsim-token');

      expect(response.status).toBe(200);
      expect(response.body.hasToken).toBe(false);
    });

    it('should return hasToken: false when token is expired', async () => {
      const app = createTestApp({
        wsimJwt: 'expired-token',
        wsimJwtExp: Date.now() - 3600000, // 1 hour ago
      });
      const response = await request(app).get('/api/user/wsim-token');

      expect(response.status).toBe(200);
      expect(response.body.hasToken).toBe(false);
      expect(response.body.reason).toBe('expired');
    });

    it('should return token when valid and not expired', async () => {
      const futureExp = Date.now() + 3600000;
      const app = createTestApp({
        wsimJwt: 'valid-token',
        wsimJwtExp: futureExp,
      });
      const response = await request(app).get('/api/user/wsim-token');

      expect(response.status).toBe(200);
      expect(response.body.hasToken).toBe(true);
      expect(response.body.token).toBe('valid-token');
      expect(response.body.expiresAt).toBe(futureExp);
    });

    it('should return hasToken: false when only token present but no expiry', async () => {
      const app = createTestApp({
        wsimJwt: 'token-without-exp',
      });
      const response = await request(app).get('/api/user/wsim-token');

      expect(response.status).toBe(200);
      expect(response.body.hasToken).toBe(false);
    });
  });
});
