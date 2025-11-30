// Mock implementations for openid-client library

export interface MockTokenSet {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  claims: () => MockIdTokenClaims;
}

export interface MockIdTokenClaims {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export const createMockTokenSet = (overrides: Partial<MockIdTokenClaims> = {}): MockTokenSet => {
  const claims: MockIdTokenClaims = {
    sub: 'test-user-id-123',
    name: 'Test User',
    given_name: 'Test',
    family_name: 'User',
    email: 'test@example.com',
    email_verified: true,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://auth.banksim.ca',
    aud: 'ssim-client',
    ...overrides,
  };

  return {
    access_token: 'mock-access-token-jwt.payload.signature',
    id_token: 'mock-id-token-jwt.payload.signature',
    refresh_token: 'mock-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    scope: 'openid profile email',
    claims: () => claims,
  };
};

export const createMockClient = (overrides: Partial<{
  authorizationUrl: jest.Mock;
  callbackParams: jest.Mock;
  callback: jest.Mock;
}> = {}) => {
  return {
    authorizationUrl: overrides.authorizationUrl || jest.fn().mockReturnValue('https://auth.banksim.ca/auth?client_id=test'),
    callbackParams: overrides.callbackParams || jest.fn().mockReturnValue({ code: 'mock-auth-code', state: 'mock-state' }),
    callback: overrides.callback || jest.fn().mockResolvedValue(createMockTokenSet()),
    issuer: {
      metadata: {
        issuer: 'https://auth.banksim.ca',
        end_session_endpoint: 'https://auth.banksim.ca/session/end',
      },
    },
  };
};

export const createMockIssuer = () => {
  return {
    metadata: {
      issuer: 'https://auth.banksim.ca',
      authorization_endpoint: 'https://auth.banksim.ca/auth',
      token_endpoint: 'https://auth.banksim.ca/token',
      userinfo_endpoint: 'https://auth.banksim.ca/me',
      end_session_endpoint: 'https://auth.banksim.ca/session/end',
    },
    Client: jest.fn().mockImplementation(() => createMockClient()),
  };
};

// Mock the entire openid-client module
export const mockOpenidClient = {
  Issuer: {
    discover: jest.fn().mockResolvedValue(createMockIssuer()),
  },
  generators: {
    state: jest.fn().mockReturnValue('mock-state-value'),
    nonce: jest.fn().mockReturnValue('mock-nonce-value'),
    codeVerifier: jest.fn().mockReturnValue('mock-code-verifier'),
    codeChallenge: jest.fn().mockReturnValue('mock-code-challenge'),
  },
};
