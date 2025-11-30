import { mockOpenidClient } from '../mocks/mockOidcClient';

// Mock openid-client before importing the module
jest.mock('openid-client', () => mockOpenidClient);

import {
  generateState,
  generateNonce,
  generateCodeVerifier,
  generateCodeChallenge,
  getProvider,
  getAllProviders,
  initializeProviders,
} from '../../config/oidc';

describe('OIDC Configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateState', () => {
    it('should return a string', () => {
      const state = generateState();
      expect(typeof state).toBe('string');
    });

    it('should call generators.state from openid-client', () => {
      generateState();
      expect(mockOpenidClient.generators.state).toHaveBeenCalled();
    });
  });

  describe('generateNonce', () => {
    it('should return a string', () => {
      const nonce = generateNonce();
      expect(typeof nonce).toBe('string');
    });

    it('should call generators.nonce from openid-client', () => {
      generateNonce();
      expect(mockOpenidClient.generators.nonce).toHaveBeenCalled();
    });
  });

  describe('generateCodeVerifier', () => {
    it('should return a string', () => {
      const verifier = generateCodeVerifier();
      expect(typeof verifier).toBe('string');
    });

    it('should call generators.codeVerifier from openid-client', () => {
      generateCodeVerifier();
      expect(mockOpenidClient.generators.codeVerifier).toHaveBeenCalled();
    });
  });

  describe('generateCodeChallenge', () => {
    it('should return a string', () => {
      const challenge = generateCodeChallenge('test-verifier');
      expect(typeof challenge).toBe('string');
    });

    it('should call generators.codeChallenge with the verifier', () => {
      const verifier = 'test-verifier';
      generateCodeChallenge(verifier);
      expect(mockOpenidClient.generators.codeChallenge).toHaveBeenCalledWith(verifier);
    });
  });

  describe('getProvider', () => {
    it('should return undefined for unknown provider', () => {
      const provider = getProvider('unknown-provider');
      expect(provider).toBeUndefined();
    });
  });

  describe('getAllProviders', () => {
    it('should return an array', () => {
      const providers = getAllProviders();
      expect(Array.isArray(providers)).toBe(true);
    });
  });

  describe('initializeProviders', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should handle empty providers list gracefully', async () => {
      // With no providers configured, initializeProviders should complete without error
      await expect(initializeProviders()).resolves.not.toThrow();
    });

    it('should log error when provider discovery fails', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockOpenidClient.Issuer.discover.mockRejectedValueOnce(new Error('Discovery failed'));

      // Set up a provider to test error handling
      process.env.OIDC_PROVIDERS = JSON.stringify([{
        id: 'failing-provider',
        name: 'Failing Provider',
        issuer: 'https://failing.example.com',
        clientId: 'test',
        clientSecret: 'test',
        scopes: 'openid',
      }]);

      // Re-import to get fresh module with new env
      jest.resetModules();
      jest.mock('openid-client', () => ({
        ...mockOpenidClient,
        Issuer: {
          discover: jest.fn().mockRejectedValue(new Error('Discovery failed')),
        },
      }));

      const { initializeProviders: freshInit } = require('../../config/oidc');
      await freshInit();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
