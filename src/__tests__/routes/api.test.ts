import express from 'express';
import request from 'supertest';
import { createMockSession, createAuthenticatedSession } from '../mocks/mockSession';
import { config } from '../../config/env';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

import apiRoutes from '../../routes/api';

// Create test app with session support
const createTestApp = (sessionData: any = {}) => {
  const app = express();
  app.use(express.json());

  // Mock session middleware
  app.use((req, res, next) => {
    req.session = createMockSession(sessionData) as any;
    next();
  });

  app.use('/api', apiRoutes);
  return app;
};

describe('API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/accounts', () => {
    it('should return 401 when not authenticated (no userInfo)', async () => {
      const app = createTestApp();
      const response = await request(app).get('/api/accounts');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Not authenticated');
    });

    it('should return 401 when no access token', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        // No tokenSet
      });
      const response = await request(app).get('/api/accounts');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Not authenticated');
    });

    it('should return 400 when no sub claim in userInfo', async () => {
      const app = createTestApp({
        userInfo: { name: 'Test User' }, // No sub claim
        tokenSet: { access_token: 'token123' },
      });
      const response = await request(app).get('/api/accounts');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No user subject (sub) found in claims');
    });

    it('should call Open Banking API with correct URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [] }),
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet: { access_token: 'test-access-token' },
      });

      await request(app).get('/api/accounts');

      expect(mockFetch).toHaveBeenCalledWith(
        `${config.openbankingBaseUrl}/users/user-123/accounts`,
        expect.any(Object)
      );
    });

    it('should pass authorization header correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [] }),
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet: { access_token: 'test-access-token' },
      });

      await request(app).get('/api/accounts');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token',
          }),
        })
      );
    });

    it('should return API response data on success', async () => {
      const mockAccounts = {
        fiUserRef: 'user-123',
        accounts: [
          { accountId: 'acc-1', accountNumber: '1234567890', balance: { current: 1000 } },
          { accountId: 'acc-2', accountNumber: '0987654321', balance: { current: 2000 } },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccounts,
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet: { access_token: 'test-access-token' },
      });

      const response = await request(app).get('/api/accounts');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockAccounts);
    });

    it('should return error status from API on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: 'Forbidden' }),
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet: { access_token: 'invalid-token' },
      });

      const response = await request(app).get('/api/accounts');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Open Banking API error');
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet: { access_token: 'test-access-token' },
      });

      const response = await request(app).get('/api/accounts');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch accounts');
      expect(response.body.details).toBe('Network error');
    });

    it('should include Accept header for JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [] }),
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet: { access_token: 'test-access-token' },
      });

      await request(app).get('/api/accounts');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json',
          }),
        })
      );
    });

    it('should use GET method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [] }),
      });

      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet: { access_token: 'test-access-token' },
      });

      await request(app).get('/api/accounts');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });
});
