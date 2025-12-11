// Mock the Prisma client - must be before imports
const mockPrismaStore = {
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockPrismaStoreUser = {
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    store: mockPrismaStore,
    storeUser: mockPrismaStoreUser,
  },
}));

// Mock the config module
jest.mock('../../config/env', () => ({
  config: {
    storeDomain: 'test.ssim.com',
    storeName: 'Test Store',
  },
}));

// Mock the product service
jest.mock('../../services/product', () => ({
  seedDefaultProducts: jest.fn().mockResolvedValue(undefined),
}));

import * as storeService from '../../services/store';
import type { Store, StoreUser } from '@prisma/client';

describe('Store Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrCreateStore', () => {
    const mockStore: Store = {
      id: 'store-123',
      domain: 'test.ssim.com',
      name: 'Test Store',
      tagline: null,
      description: null,
      logoUrl: null,
      heroImageUrl: null,
      themePreset: 'default',
      envBadge: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return existing store if found', async () => {
      mockPrismaStore.findUnique.mockResolvedValue(mockStore);

      const result = await storeService.getOrCreateStore();

      expect(result).toEqual(mockStore);
      expect(mockPrismaStore.findUnique).toHaveBeenCalledWith({
        where: { domain: 'test.ssim.com' },
      });
      expect(mockPrismaStore.create).not.toHaveBeenCalled();
    });

    it('should create new store if not found', async () => {
      mockPrismaStore.findUnique.mockResolvedValue(null);
      mockPrismaStore.create.mockResolvedValue(mockStore);

      const result = await storeService.getOrCreateStore();

      expect(result).toEqual(mockStore);
      expect(mockPrismaStore.create).toHaveBeenCalledWith({
        data: {
          domain: 'test.ssim.com',
          name: 'Test Store',
        },
      });
    });

    it('should seed default products for new store', async () => {
      const { seedDefaultProducts } = require('../../services/product');
      mockPrismaStore.findUnique.mockResolvedValue(null);
      mockPrismaStore.create.mockResolvedValue(mockStore);

      await storeService.getOrCreateStore();

      expect(seedDefaultProducts).toHaveBeenCalledWith('store-123');
    });

    it('should handle seed error gracefully', async () => {
      const { seedDefaultProducts } = require('../../services/product');
      seedDefaultProducts.mockRejectedValue(new Error('Seed failed'));
      mockPrismaStore.findUnique.mockResolvedValue(null);
      mockPrismaStore.create.mockResolvedValue(mockStore);

      // Should not throw
      const result = await storeService.getOrCreateStore();
      expect(result).toEqual(mockStore);
    });
  });

  describe('getOrCreateStoreUser', () => {
    const mockUser: StoreUser = {
      id: 'user-123',
      storeId: 'store-123',
      bsimUserId: 'bsim-user-456',
      email: 'test@example.com',
      name: 'Test User',
      consentedScopes: [],
      wsimJwt: null,
      wsimJwtExp: null,
      firstLoginAt: new Date(),
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return existing user if found', async () => {
      const updatedUser = { ...mockUser, lastLoginAt: new Date() };
      mockPrismaStoreUser.findUnique.mockResolvedValue(mockUser);
      mockPrismaStoreUser.update.mockResolvedValue(updatedUser);

      const result = await storeService.getOrCreateStoreUser(
        'store-123',
        'bsim-user-456',
        'test@example.com',
        'Test User'
      );

      expect(result).toEqual(updatedUser);
      expect(mockPrismaStoreUser.findUnique).toHaveBeenCalledWith({
        where: {
          storeId_bsimUserId: {
            storeId: 'store-123',
            bsimUserId: 'bsim-user-456',
          },
        },
      });
    });

    it('should create new user if not found', async () => {
      mockPrismaStoreUser.findUnique.mockResolvedValue(null);
      mockPrismaStoreUser.create.mockResolvedValue(mockUser);

      const result = await storeService.getOrCreateStoreUser(
        'store-123',
        'bsim-user-456',
        'test@example.com',
        'Test User'
      );

      expect(result).toEqual(mockUser);
      expect(mockPrismaStoreUser.create).toHaveBeenCalledWith({
        data: {
          storeId: 'store-123',
          bsimUserId: 'bsim-user-456',
          email: 'test@example.com',
          name: 'Test User',
        },
      });
    });

    it('should update existing user login time and info', async () => {
      const updatedUser = { ...mockUser, name: 'Updated Name' };
      mockPrismaStoreUser.findUnique.mockResolvedValue(mockUser);
      mockPrismaStoreUser.update.mockResolvedValue(updatedUser);

      await storeService.getOrCreateStoreUser(
        'store-123',
        'bsim-user-456',
        'newemail@example.com',
        'Updated Name'
      );

      expect(mockPrismaStoreUser.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          lastLoginAt: expect.any(Date),
          email: 'newemail@example.com',
          name: 'Updated Name',
        },
      });
    });
  });

  describe('getStoreUserByBsimId', () => {
    it('should return user by BSIM ID', async () => {
      const mockUser: StoreUser = {
        id: 'user-123',
        storeId: 'store-123',
        bsimUserId: 'bsim-user-456',
        email: 'test@example.com',
        name: 'Test User',
        consentedScopes: [],
        wsimJwt: null,
        wsimJwtExp: null,
        firstLoginAt: new Date(),
        lastLoginAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaStoreUser.findUnique.mockResolvedValue(mockUser);

      const result = await storeService.getStoreUserByBsimId('store-123', 'bsim-user-456');

      expect(result).toEqual(mockUser);
      expect(mockPrismaStoreUser.findUnique).toHaveBeenCalledWith({
        where: {
          storeId_bsimUserId: {
            storeId: 'store-123',
            bsimUserId: 'bsim-user-456',
          },
        },
      });
    });

    it('should return null if user not found', async () => {
      mockPrismaStoreUser.findUnique.mockResolvedValue(null);

      const result = await storeService.getStoreUserByBsimId('store-123', 'unknown');

      expect(result).toBeNull();
    });
  });

  describe('updateConsentedScopes', () => {
    it('should update user consented scopes', async () => {
      const mockUser: StoreUser = {
        id: 'user-123',
        storeId: 'store-123',
        bsimUserId: 'bsim-user-456',
        email: 'test@example.com',
        name: 'Test User',
        consentedScopes: ['openid', 'profile'],
        wsimJwt: null,
        wsimJwtExp: null,
        firstLoginAt: new Date(),
        lastLoginAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaStoreUser.update.mockResolvedValue(mockUser);

      const result = await storeService.updateConsentedScopes('user-123', ['openid', 'profile']);

      expect(result.consentedScopes).toEqual(['openid', 'profile']);
      expect(mockPrismaStoreUser.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          consentedScopes: ['openid', 'profile'],
        },
      });
    });
  });

  describe('hasConsentedToScopes', () => {
    it('should return true when all scopes are consented', () => {
      const user: StoreUser = {
        id: 'user-123',
        storeId: 'store-123',
        bsimUserId: 'bsim-user-456',
        email: 'test@example.com',
        name: 'Test User',
        consentedScopes: ['openid', 'profile', 'email'],
        wsimJwt: null,
        wsimJwtExp: null,
        firstLoginAt: new Date(),
        lastLoginAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = storeService.hasConsentedToScopes(user, ['openid', 'profile']);

      expect(result).toBe(true);
    });

    it('should return false when some scopes are missing', () => {
      const user: StoreUser = {
        id: 'user-123',
        storeId: 'store-123',
        bsimUserId: 'bsim-user-456',
        email: 'test@example.com',
        name: 'Test User',
        consentedScopes: ['openid'],
        wsimJwt: null,
        wsimJwtExp: null,
        firstLoginAt: new Date(),
        lastLoginAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = storeService.hasConsentedToScopes(user, ['openid', 'profile']);

      expect(result).toBe(false);
    });

    it('should return true for empty requested scopes', () => {
      const user: StoreUser = {
        id: 'user-123',
        storeId: 'store-123',
        bsimUserId: 'bsim-user-456',
        email: 'test@example.com',
        name: 'Test User',
        consentedScopes: [],
        wsimJwt: null,
        wsimJwtExp: null,
        firstLoginAt: new Date(),
        lastLoginAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = storeService.hasConsentedToScopes(user, []);

      expect(result).toBe(true);
    });
  });

  describe('WSIM JWT functions', () => {
    const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
    const pastDate = new Date(Date.now() - 3600000); // 1 hour ago

    describe('updateWsimJwt', () => {
      it('should update user WSIM JWT', async () => {
        const mockUser: StoreUser = {
          id: 'user-123',
          storeId: 'store-123',
          bsimUserId: 'bsim-user-456',
          email: 'test@example.com',
          name: 'Test User',
          consentedScopes: [],
          wsimJwt: 'new-jwt-token',
          wsimJwtExp: futureDate,
          firstLoginAt: new Date(),
          lastLoginAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        mockPrismaStoreUser.update.mockResolvedValue(mockUser);

        const result = await storeService.updateWsimJwt('user-123', 'new-jwt-token', futureDate);

        expect(result.wsimJwt).toBe('new-jwt-token');
        expect(mockPrismaStoreUser.update).toHaveBeenCalledWith({
          where: { id: 'user-123' },
          data: {
            wsimJwt: 'new-jwt-token',
            wsimJwtExp: futureDate,
          },
        });
      });
    });

    describe('clearWsimJwt', () => {
      it('should clear user WSIM JWT', async () => {
        const mockUser: StoreUser = {
          id: 'user-123',
          storeId: 'store-123',
          bsimUserId: 'bsim-user-456',
          email: 'test@example.com',
          name: 'Test User',
          consentedScopes: [],
          wsimJwt: null,
          wsimJwtExp: null,
          firstLoginAt: new Date(),
          lastLoginAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        mockPrismaStoreUser.update.mockResolvedValue(mockUser);

        const result = await storeService.clearWsimJwt('user-123');

        expect(result.wsimJwt).toBeNull();
        expect(mockPrismaStoreUser.update).toHaveBeenCalledWith({
          where: { id: 'user-123' },
          data: {
            wsimJwt: null,
            wsimJwtExp: null,
          },
        });
      });
    });

    describe('getValidWsimJwt', () => {
      it('should return JWT if valid and not expired', () => {
        const user: StoreUser = {
          id: 'user-123',
          storeId: 'store-123',
          bsimUserId: 'bsim-user-456',
          email: 'test@example.com',
          name: 'Test User',
          consentedScopes: [],
          wsimJwt: 'valid-jwt',
          wsimJwtExp: futureDate,
          firstLoginAt: new Date(),
          lastLoginAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = storeService.getValidWsimJwt(user);

        expect(result).toBe('valid-jwt');
      });

      it('should return null if JWT is missing', () => {
        const user: StoreUser = {
          id: 'user-123',
          storeId: 'store-123',
          bsimUserId: 'bsim-user-456',
          email: 'test@example.com',
          name: 'Test User',
          consentedScopes: [],
          wsimJwt: null,
          wsimJwtExp: null,
          firstLoginAt: new Date(),
          lastLoginAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = storeService.getValidWsimJwt(user);

        expect(result).toBeNull();
      });

      it('should return null if JWT is expired', () => {
        const user: StoreUser = {
          id: 'user-123',
          storeId: 'store-123',
          bsimUserId: 'bsim-user-456',
          email: 'test@example.com',
          name: 'Test User',
          consentedScopes: [],
          wsimJwt: 'expired-jwt',
          wsimJwtExp: pastDate,
          firstLoginAt: new Date(),
          lastLoginAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = storeService.getValidWsimJwt(user);

        expect(result).toBeNull();
      });

      it('should return null if expiry date is missing', () => {
        const user: StoreUser = {
          id: 'user-123',
          storeId: 'store-123',
          bsimUserId: 'bsim-user-456',
          email: 'test@example.com',
          name: 'Test User',
          consentedScopes: [],
          wsimJwt: 'some-jwt',
          wsimJwtExp: null,
          firstLoginAt: new Date(),
          lastLoginAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = storeService.getValidWsimJwt(user);

        expect(result).toBeNull();
      });
    });
  });

  describe('Store Branding functions', () => {
    describe('getStoreBranding', () => {
      it('should return branding with defaults', async () => {
        mockPrismaStore.findUnique.mockResolvedValue({
          name: 'Custom Store',
          tagline: 'Best prices',
          description: 'A great store',
          logoUrl: '/uploads/logo.png',
          heroImageUrl: '/uploads/hero.jpg',
          themePreset: 'amazon',
          envBadge: 'DEV',
        });

        const result = await storeService.getStoreBranding('store-123');

        expect(result).toEqual({
          name: 'Custom Store',
          tagline: 'Best prices',
          description: 'A great store',
          logoUrl: '/uploads/logo.png',
          heroImageUrl: '/uploads/hero.jpg',
          themePreset: 'amazon',
          envBadge: 'DEV',
        });
      });

      it('should return null for non-existent store', async () => {
        mockPrismaStore.findUnique.mockResolvedValue(null);

        const result = await storeService.getStoreBranding('unknown');

        expect(result).toBeNull();
      });

      it('should fall back to config for name if not set', async () => {
        mockPrismaStore.findUnique.mockResolvedValue({
          name: null,
          tagline: null,
          description: null,
          logoUrl: null,
          heroImageUrl: null,
          themePreset: null,
          envBadge: null,
        });

        const result = await storeService.getStoreBranding('store-123');

        expect(result?.name).toBe('Test Store');
        expect(result?.themePreset).toBe('default');
      });
    });

    describe('updateStoreBranding', () => {
      it('should update store branding', async () => {
        const updatedStore: Store = {
          id: 'store-123',
          domain: 'test.ssim.com',
          name: 'Updated Store',
          tagline: 'New tagline',
          description: 'New description',
          logoUrl: '/uploads/newlogo.png',
          heroImageUrl: '/uploads/newhero.jpg',
          themePreset: 'walmart',
          envBadge: 'PROD',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        mockPrismaStore.update.mockResolvedValue(updatedStore);

        const result = await storeService.updateStoreBranding('store-123', {
          name: 'Updated Store',
          tagline: 'New tagline',
          description: 'New description',
          logoUrl: '/uploads/newlogo.png',
          heroImageUrl: '/uploads/newhero.jpg',
          themePreset: 'walmart',
          envBadge: 'PROD',
        });

        expect(result).toEqual(updatedStore);
        expect(mockPrismaStore.update).toHaveBeenCalledWith({
          where: { id: 'store-123' },
          data: {
            name: 'Updated Store',
            tagline: 'New tagline',
            description: 'New description',
            logoUrl: '/uploads/newlogo.png',
            heroImageUrl: '/uploads/newhero.jpg',
            themePreset: 'walmart',
            envBadge: 'PROD',
          },
        });
      });
    });

    describe('getStoreById', () => {
      it('should return store by ID', async () => {
        const mockStore: Store = {
          id: 'store-123',
          domain: 'test.ssim.com',
          name: 'Test Store',
          tagline: null,
          description: null,
          logoUrl: null,
          heroImageUrl: null,
          themePreset: 'default',
          envBadge: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        mockPrismaStore.findUnique.mockResolvedValue(mockStore);

        const result = await storeService.getStoreById('store-123');

        expect(result).toEqual(mockStore);
        expect(mockPrismaStore.findUnique).toHaveBeenCalledWith({
          where: { id: 'store-123' },
        });
      });

      it('should return null for non-existent store', async () => {
        mockPrismaStore.findUnique.mockResolvedValue(null);

        const result = await storeService.getStoreById('unknown');

        expect(result).toBeNull();
      });
    });
  });
});
