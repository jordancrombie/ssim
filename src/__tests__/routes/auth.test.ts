import express from 'express';
import request from 'supertest';
import { createMockSession, createOidcStateSession, createAuthenticatedSession } from '../mocks/mockSession';
import { createMockClient, createMockTokenSet } from '../mocks/mockOidcClient';

// Create mock provider and OIDC functions
const mockClient = createMockClient();
const mockProvider = {
  config: {
    id: 'bsim',
    name: 'BSIM Bank',
    issuer: 'https://auth.banksim.ca',
    clientId: 'ssim-client',
    clientSecret: 'test-secret',
    scopes: 'openid profile email',
  },
  client: mockClient,
};

// Mock the oidc module
jest.mock('../../config/oidc', () => ({
  getProvider: jest.fn((id: string) => {
    if (id === 'bsim') return mockProvider;
    return undefined;
  }),
  getAllProviders: jest.fn().mockReturnValue([{ id: 'bsim', name: 'BSIM Bank' }]),
  generateState: jest.fn().mockReturnValue('mock-state-value'),
  generateNonce: jest.fn().mockReturnValue('mock-nonce-value'),
  generateCodeVerifier: jest.fn().mockReturnValue('mock-code-verifier'),
  generateCodeChallenge: jest.fn().mockReturnValue('mock-code-challenge'),
}));

// Mock the env config
jest.mock('../../config/env', () => ({
  config: {
    appBaseUrl: 'http://localhost:3005',
    nodeEnv: 'test',
  },
}));

import authRoutes from '../../routes/auth';

// Create test app with session support
const createTestApp = (sessionData: any = {}) => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock session middleware
  app.use((req, res, next) => {
    req.session = createMockSession(sessionData) as any;
    next();
  });

  app.use('/auth', authRoutes);
  return app;
};

describe('Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /auth/providers', () => {
    it('should return list of providers', async () => {
      const app = createTestApp();
      const response = await request(app).get('/auth/providers');

      expect(response.status).toBe(200);
      expect(response.body.providers).toBeDefined();
      expect(Array.isArray(response.body.providers)).toBe(true);
    });

    it('should include provider id and name', async () => {
      const app = createTestApp();
      const response = await request(app).get('/auth/providers');

      expect(response.body.providers).toContainEqual(
        expect.objectContaining({ id: 'bsim', name: 'BSIM Bank' })
      );
    });
  });

  describe('GET /auth/login/:providerId', () => {
    it('should return 404 for unknown provider', async () => {
      const app = createTestApp();
      const response = await request(app).get('/auth/login/unknown-provider');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Provider not found');
    });

    it('should redirect to authorization URL for valid provider', async () => {
      const app = createTestApp();
      const response = await request(app).get('/auth/login/bsim');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('auth.banksim.ca');
    });

    it('should store OIDC state in session', async () => {
      let capturedSession: any;
      const app = express();
      app.use(express.json());

      const session = createMockSession();
      app.use((req, res, next) => {
        req.session = session as any;
        capturedSession = req.session;
        next();
      });
      app.use('/auth', authRoutes);

      await request(app).get('/auth/login/bsim');

      expect(capturedSession.oidcState).toBe('mock-state-value');
    });

    it('should store nonce in session', async () => {
      let capturedSession: any;
      const app = express();
      app.use(express.json());

      const session = createMockSession();
      app.use((req, res, next) => {
        req.session = session as any;
        capturedSession = req.session;
        next();
      });
      app.use('/auth', authRoutes);

      await request(app).get('/auth/login/bsim');

      expect(capturedSession.oidcNonce).toBe('mock-nonce-value');
    });

    it('should store code verifier in session', async () => {
      let capturedSession: any;
      const app = express();
      app.use(express.json());

      const session = createMockSession();
      app.use((req, res, next) => {
        req.session = session as any;
        capturedSession = req.session;
        next();
      });
      app.use('/auth', authRoutes);

      await request(app).get('/auth/login/bsim');

      expect(capturedSession.codeVerifier).toBe('mock-code-verifier');
    });

    it('should store provider ID in session', async () => {
      let capturedSession: any;
      const app = express();
      app.use(express.json());

      const session = createMockSession();
      app.use((req, res, next) => {
        req.session = session as any;
        capturedSession = req.session;
        next();
      });
      app.use('/auth', authRoutes);

      await request(app).get('/auth/login/bsim');

      expect(capturedSession.providerId).toBe('bsim');
    });
  });

  describe('GET /auth/callback/:providerId', () => {
    it('should return 404 for unknown provider', async () => {
      const app = createTestApp(createOidcStateSession());
      const response = await request(app)
        .get('/auth/callback/unknown-provider')
        .query({ code: 'auth-code', state: 'mock-state-value' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Provider not found');
    });

    it('should return 400 when session state is missing', async () => {
      const app = createTestApp({ codeVerifier: 'verifier' }); // Missing oidcState
      const response = await request(app)
        .get('/auth/callback/bsim')
        .query({ code: 'auth-code', state: 'state' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid session state');
    });

    it('should return 400 when code verifier is missing', async () => {
      const app = createTestApp({ oidcState: 'state' }); // Missing codeVerifier
      const response = await request(app)
        .get('/auth/callback/bsim')
        .query({ code: 'auth-code', state: 'state' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid session state');
    });

    it('should redirect to /profile on successful callback', async () => {
      const sessionData = {
        oidcState: 'mock-state-value',
        oidcNonce: 'mock-nonce-value',
        codeVerifier: 'mock-code-verifier',
        providerId: 'bsim',
      };
      const app = createTestApp(sessionData);

      const response = await request(app)
        .get('/auth/callback/bsim')
        .query({ code: 'auth-code', state: 'mock-state-value' });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/profile');
    });

    it('should store user info from ID token claims in session', async () => {
      let capturedSession: any;
      const app = express();
      app.use(express.json());

      const session = createOidcStateSession();
      app.use((req, res, next) => {
        req.session = session as any;
        capturedSession = req.session;
        next();
      });
      app.use('/auth', authRoutes);

      await request(app)
        .get('/auth/callback/bsim')
        .query({ code: 'auth-code', state: 'mock-state-value' });

      expect(capturedSession.userInfo).toBeDefined();
      expect(capturedSession.userInfo.sub).toBe('test-user-id-123');
    });

    it('should store token set in session', async () => {
      let capturedSession: any;
      const app = express();
      app.use(express.json());

      const session = createOidcStateSession();
      app.use((req, res, next) => {
        req.session = session as any;
        capturedSession = req.session;
        next();
      });
      app.use('/auth', authRoutes);

      await request(app)
        .get('/auth/callback/bsim')
        .query({ code: 'auth-code', state: 'mock-state-value' });

      expect(capturedSession.tokenSet).toBeDefined();
      expect(capturedSession.tokenSet.access_token).toBeDefined();
    });

    it('should clear temporary OIDC state after callback', async () => {
      let capturedSession: any;
      const app = express();
      app.use(express.json());

      const session = createOidcStateSession();
      app.use((req, res, next) => {
        req.session = session as any;
        capturedSession = req.session;
        next();
      });
      app.use('/auth', authRoutes);

      await request(app)
        .get('/auth/callback/bsim')
        .query({ code: 'auth-code', state: 'mock-state-value' });

      expect(capturedSession.oidcState).toBeUndefined();
      expect(capturedSession.oidcNonce).toBeUndefined();
      expect(capturedSession.codeVerifier).toBeUndefined();
    });

    it('should return 500 on OIDC callback error', async () => {
      mockClient.callback.mockRejectedValueOnce(new Error('Token exchange failed'));

      const sessionData = {
        oidcState: 'mock-state-value',
        oidcNonce: 'mock-nonce-value',
        codeVerifier: 'mock-code-verifier',
        providerId: 'bsim',
      };
      const app = createTestApp(sessionData);

      const response = await request(app)
        .get('/auth/callback/bsim')
        .query({ code: 'auth-code', state: 'mock-state-value' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Authentication failed');
    });
  });

  describe('GET /auth/logout', () => {
    it('should destroy session', async () => {
      let sessionDestroyed = false;
      const app = express();
      app.use(express.json());

      const session = createAuthenticatedSession();
      // Override destroy with proper typing
      (session as any).destroy = jest.fn((cb: (err?: Error) => void) => {
        sessionDestroyed = true;
        cb();
      });

      app.use((req, res, next) => {
        req.session = session as any;
        next();
      });
      app.use('/auth', authRoutes);

      await request(app).get('/auth/logout');

      expect(sessionDestroyed).toBe(true);
    });

    it('should redirect to home when no provider logout available', async () => {
      const app = createTestApp(); // No session = no provider info
      const response = await request(app).get('/auth/logout');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/');
    });

    it('should redirect to provider logout when available', async () => {
      const app = express();
      app.use(express.json());

      const session = createAuthenticatedSession();
      app.use((req, res, next) => {
        req.session = session as any;
        next();
      });
      app.use('/auth', authRoutes);

      const response = await request(app).get('/auth/logout');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('auth.banksim.ca/session/end');
    });
  });

  describe('GET /auth/me', () => {
    it('should return 401 when not authenticated', async () => {
      const app = createTestApp();
      const response = await request(app).get('/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Not authenticated');
    });

    it('should return user info when authenticated', async () => {
      const userInfo = { sub: 'user-123', name: 'Test User', email: 'test@example.com' };
      const app = createTestApp({
        userInfo,
        tokenSet: { access_token: 'token123' },
        providerId: 'bsim',
      });

      const response = await request(app).get('/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.userInfo).toEqual(userInfo);
    });

    it('should return token set and provider ID', async () => {
      const tokenSet = { access_token: 'token123', scope: 'openid profile' };
      const app = createTestApp({
        userInfo: { sub: 'user-123' },
        tokenSet,
        providerId: 'bsim',
      });

      const response = await request(app).get('/auth/me');

      expect(response.body.tokenSet).toEqual(tokenSet);
      expect(response.body.providerId).toBe('bsim');
    });
  });
});
