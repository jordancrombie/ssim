import express from 'express';
import request from 'supertest';
import session from 'express-session';
import pageRoutes from '../../routes/pages';
import { createMockSession, createAuthenticatedSession } from '../mocks/mockSession';

// Mock the oidc module
jest.mock('../../config/oidc', () => ({
  getAllProviders: jest.fn().mockReturnValue([
    { id: 'bsim', name: 'BSIM Bank' },
  ]),
}));

// Create test app
const createTestApp = (sessionData: any = {}) => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', 'src/views');

  // Mock session middleware
  app.use((req, res, next) => {
    req.session = createMockSession(sessionData) as any;
    next();
  });

  // Mock render to just return the template name and data
  app.use((req, res, next) => {
    res.render = ((view: string, options: any = {}) => {
      res.json({ view, options });
    }) as any;
    next();
  });

  app.use('/', pageRoutes);
  return app;
};

describe('Page Routes', () => {
  describe('GET /', () => {
    it('should render home page', async () => {
      const app = createTestApp();
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('homepage');
    });

    it('should pass isAuthenticated: false when not logged in', async () => {
      const app = createTestApp();
      const response = await request(app).get('/');

      expect(response.body.options.isAuthenticated).toBe(false);
    });

    it('should pass isAuthenticated: true when logged in', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123', name: 'Test User' },
      });
      const response = await request(app).get('/');

      expect(response.body.options.isAuthenticated).toBe(true);
    });

    it('should pass userInfo when logged in', async () => {
      const userInfo = { sub: 'user-123', name: 'Test User' };
      const app = createTestApp({ userInfo });
      const response = await request(app).get('/');

      expect(response.body.options.userInfo).toEqual(userInfo);
    });
  });

  describe('GET /login', () => {
    it('should render login page when not authenticated', async () => {
      const app = createTestApp();
      const response = await request(app).get('/login');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('login');
    });

    it('should redirect to /profile when already authenticated', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
      });
      const response = await request(app).get('/login');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/profile');
    });

    it('should pass providers list to template', async () => {
      const app = createTestApp();
      const response = await request(app).get('/login');

      expect(response.body.options.providers).toBeDefined();
      expect(response.body.options.providers).toHaveLength(1);
      expect(response.body.options.providers[0].id).toBe('bsim');
    });
  });

  describe('GET /profile', () => {
    it('should redirect to /login when not authenticated', async () => {
      const app = createTestApp();
      const response = await request(app).get('/profile');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    it('should render profile when authenticated', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123', name: 'Test User' },
        tokenSet: { access_token: 'token123' },
        providerId: 'bsim',
      });
      const response = await request(app).get('/profile');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('profile');
    });

    it('should pass userInfo, tokenSet, and providerId to template', async () => {
      const userInfo = { sub: 'user-123', name: 'Test User' };
      const tokenSet = { access_token: 'token123' };
      const providerId = 'bsim';

      const app = createTestApp({ userInfo, tokenSet, providerId });
      const response = await request(app).get('/profile');

      expect(response.body.options.userInfo).toEqual(userInfo);
      expect(response.body.options.tokenSet).toEqual(tokenSet);
      expect(response.body.options.providerId).toBe(providerId);
    });
  });

  describe('GET /kenok', () => {
    it('should redirect to /login when not authenticated', async () => {
      const app = createTestApp();
      const response = await request(app).get('/kenok');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    it('should render kenok page when authenticated', async () => {
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet: { access_token: 'token123' },
      });
      const response = await request(app).get('/kenok');

      expect(response.status).toBe(200);
      expect(response.body.view).toBe('kenok');
    });

    it('should pass userInfo and tokenSet to template', async () => {
      const userInfo = { sub: 'user-123', name: 'Test User' };
      const tokenSet = { access_token: 'token123', scope: 'openid profile' };

      const app = createTestApp({ userInfo, tokenSet });
      const response = await request(app).get('/kenok');

      expect(response.body.options.userInfo).toEqual(userInfo);
      expect(response.body.options.tokenSet).toEqual(tokenSet);
    });
  });
});
