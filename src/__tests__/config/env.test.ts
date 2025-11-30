// Mock dotenv before any imports
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    // Create a clean environment without any existing values
    process.env = {};
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('config defaults', () => {
    it('should use default port 3005 when PORT is not set', () => {
      const { config } = require('../../config/env');
      expect(config.port).toBe(3005);
    });

    it('should parse PORT as integer', () => {
      process.env.PORT = '4000';
      const { config } = require('../../config/env');
      expect(config.port).toBe(4000);
      expect(typeof config.port).toBe('number');
    });

    it('should use default NODE_ENV as development', () => {
      const { config } = require('../../config/env');
      expect(config.nodeEnv).toBe('development');
    });

    it('should use default session secret', () => {
      const { config } = require('../../config/env');
      expect(config.sessionSecret).toBe('dev-session-secret');
    });

    it('should use default APP_BASE_URL', () => {
      const { config } = require('../../config/env');
      expect(config.appBaseUrl).toBe('http://localhost:3005');
    });
  });

  describe('provider parsing', () => {
    it('should return empty array when OIDC_PROVIDERS is not set', () => {
      const { config } = require('../../config/env');
      expect(config.providers).toEqual([]);
    });

    it('should parse valid JSON provider configuration', () => {
      process.env.OIDC_PROVIDERS = JSON.stringify([
        {
          id: 'test-provider',
          name: 'Test Provider',
          issuer: 'https://auth.example.com',
          clientId: 'test-client',
          clientSecret: 'test-secret',
          scopes: 'openid profile email',
        },
      ]);
      const { config } = require('../../config/env');
      expect(config.providers).toHaveLength(1);
      expect(config.providers[0].id).toBe('test-provider');
      expect(config.providers[0].name).toBe('Test Provider');
    });

    it('should return empty array for invalid JSON', () => {
      process.env.OIDC_PROVIDERS = 'invalid json {';
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const { config } = require('../../config/env');
      expect(config.providers).toEqual([]);
      consoleSpy.mockRestore();
    });

    it('should handle multiple providers', () => {
      process.env.OIDC_PROVIDERS = JSON.stringify([
        { id: 'provider1', name: 'Provider 1', issuer: 'https://auth1.example.com', clientId: 'c1', clientSecret: 's1', scopes: 'openid' },
        { id: 'provider2', name: 'Provider 2', issuer: 'https://auth2.example.com', clientId: 'c2', clientSecret: 's2', scopes: 'openid' },
      ]);
      const { config } = require('../../config/env');
      expect(config.providers).toHaveLength(2);
    });
  });
});
