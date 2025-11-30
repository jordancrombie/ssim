import express from 'express';
import request from 'supertest';

// Mock the config/oidc module before importing
jest.mock('../config/oidc', () => ({
  initializeProviders: jest.fn().mockResolvedValue(undefined),
  getAllProviders: jest.fn().mockReturnValue([]),
  getProvider: jest.fn().mockReturnValue(undefined),
  generateState: jest.fn().mockReturnValue('mock-state'),
  generateNonce: jest.fn().mockReturnValue('mock-nonce'),
  generateCodeVerifier: jest.fn().mockReturnValue('mock-verifier'),
  generateCodeChallenge: jest.fn().mockReturnValue('mock-challenge'),
}));

// Create a minimal test app that mimics the server setup
const createTestApp = () => {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Test error endpoint
  app.get('/test-error', (req, res, next) => {
    next(new Error('Test error message'));
  });

  // Error handler (matching the one in server.ts)
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
};

describe('Server', () => {
  describe('GET /health', () => {
    it('should return 200 status', async () => {
      const app = createTestApp();
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
    });

    it('should return JSON with status ok', async () => {
      const app = createTestApp();
      const response = await request(app).get('/health');

      expect(response.body.status).toBe('ok');
    });

    it('should return timestamp in ISO format', async () => {
      const app = createTestApp();
      const response = await request(app).get('/health');

      expect(response.body.timestamp).toBeDefined();
      // Check that timestamp is a valid ISO date string
      expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
    });
  });

  describe('Error handling', () => {
    it('should return 500 for unhandled errors', async () => {
      const app = createTestApp();
      const response = await request(app).get('/test-error');

      expect(response.status).toBe(500);
    });

    it('should return Internal server error message', async () => {
      const app = createTestApp();
      const response = await request(app).get('/test-error');

      expect(response.body.error).toBe('Internal server error');
    });

    it('should include error message in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const app = createTestApp();
      const response = await request(app).get('/test-error');

      expect(response.body.message).toBe('Test error message');

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include error message in production mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const app = createTestApp();
      const response = await request(app).get('/test-error');

      expect(response.body.message).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Middleware', () => {
    it('should parse JSON body', async () => {
      const app = createTestApp();
      app.post('/test-json', (req, res) => {
        res.json(req.body);
      });

      const response = await request(app)
        .post('/test-json')
        .send({ test: 'value' })
        .set('Content-Type', 'application/json');

      expect(response.body).toEqual({ test: 'value' });
    });

    it('should parse URL-encoded body', async () => {
      const app = createTestApp();
      app.post('/test-form', (req, res) => {
        res.json(req.body);
      });

      const response = await request(app)
        .post('/test-form')
        .send('test=value')
        .set('Content-Type', 'application/x-www-form-urlencoded');

      expect(response.body).toEqual({ test: 'value' });
    });
  });
});
