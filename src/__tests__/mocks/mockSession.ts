// Mock implementations for express-session

import { Session, SessionData } from 'express-session';

export interface MockSessionData extends Partial<SessionData> {
  oidcState?: string;
  oidcNonce?: string;
  codeVerifier?: string;
  providerId?: string;
  userInfo?: Record<string, unknown>;
  tokenSet?: {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    expires_at?: number;
    scope?: string;
  };
}

export const createMockSession = (data: MockSessionData = {}): Session & MockSessionData => {
  const session: any = {
    id: 'mock-session-id',
    cookie: {
      originalMaxAge: 86400000,
      expires: new Date(Date.now() + 86400000),
      secure: false,
      httpOnly: true,
      path: '/',
    },
    regenerate: jest.fn((callback: (err?: Error) => void) => callback()),
    destroy: jest.fn((callback: (err?: Error) => void) => callback()),
    reload: jest.fn((callback: (err?: Error) => void) => callback()),
    save: jest.fn((callback?: (err?: Error) => void) => callback?.()),
    touch: jest.fn(),
    resetMaxAge: jest.fn(),
    ...data,
  };

  return session;
};

export const createAuthenticatedSession = (overrides: Partial<MockSessionData> = {}): Session & MockSessionData => {
  return createMockSession({
    providerId: 'bsim',
    userInfo: {
      sub: 'test-user-id-123',
      name: 'Test User',
      given_name: 'Test',
      family_name: 'User',
      email: 'test@example.com',
      email_verified: true,
    },
    tokenSet: {
      access_token: 'mock-access-token-jwt.payload.signature',
      id_token: 'mock-id-token-jwt.payload.signature',
      refresh_token: 'mock-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      scope: 'openid profile email fdx:accountdetailed:read',
    },
    ...overrides,
  });
};

export const createOidcStateSession = (overrides: Partial<MockSessionData> = {}): Session & MockSessionData => {
  return createMockSession({
    oidcState: 'mock-state-value',
    oidcNonce: 'mock-nonce-value',
    codeVerifier: 'mock-code-verifier',
    providerId: 'bsim',
    ...overrides,
  });
};
