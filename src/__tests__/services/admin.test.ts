import * as adminService from '../../services/admin';

// Mock prisma
jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    storeAdmin: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

// Mock config
jest.mock('../../config/env', () => ({
  config: {
    adminEmails: ['super@example.com', 'superadmin@test.com'],
  },
}));

import prisma from '../../lib/prisma';

const mockStoreAdmin = {
  id: 'admin-1',
  storeId: 'store-123',
  email: 'admin@example.com',
  role: 'admin',
  isActive: true,
  createdBy: 'creator@example.com',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Admin Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isAdmin', () => {
    it('should return true for super admins in config', async () => {
      const result = await adminService.isAdmin('store-123', 'super@example.com');
      expect(result).toBe(true);
      // Should not query database for super admins
      expect(prisma.storeAdmin.findUnique).not.toHaveBeenCalled();
    });

    it('should normalize email to lowercase', async () => {
      const result = await adminService.isAdmin('store-123', 'SUPER@EXAMPLE.COM');
      expect(result).toBe(true);
    });

    it('should check database for non-super admin', async () => {
      (prisma.storeAdmin.findUnique as jest.Mock).mockResolvedValue(mockStoreAdmin);

      const result = await adminService.isAdmin('store-123', 'admin@example.com');
      expect(result).toBe(true);
      expect(prisma.storeAdmin.findUnique).toHaveBeenCalledWith({
        where: {
          storeId_email: {
            storeId: 'store-123',
            email: 'admin@example.com',
          },
        },
      });
    });

    it('should return false for inactive admin', async () => {
      (prisma.storeAdmin.findUnique as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        isActive: false,
      });

      const result = await adminService.isAdmin('store-123', 'admin@example.com');
      expect(result).toBe(false);
    });

    it('should return false for unknown user', async () => {
      (prisma.storeAdmin.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await adminService.isAdmin('store-123', 'unknown@example.com');
      expect(result).toBe(false);
    });
  });

  describe('getAdminRole', () => {
    it('should return super for env-based admins', async () => {
      const result = await adminService.getAdminRole('store-123', 'super@example.com');
      expect(result).toBe('super');
    });

    it('should return role from database for store admins', async () => {
      (prisma.storeAdmin.findUnique as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        role: 'product_editor',
      });

      const result = await adminService.getAdminRole('store-123', 'admin@example.com');
      expect(result).toBe('product_editor');
    });

    it('should return null for inactive admin', async () => {
      (prisma.storeAdmin.findUnique as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        isActive: false,
      });

      const result = await adminService.getAdminRole('store-123', 'admin@example.com');
      expect(result).toBeNull();
    });

    it('should return null for non-existent admin', async () => {
      (prisma.storeAdmin.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await adminService.getAdminRole('store-123', 'unknown@example.com');
      expect(result).toBeNull();
    });
  });

  describe('hasRole', () => {
    it('should return true for super admins regardless of role requirement', async () => {
      const result = await adminService.hasRole('store-123', 'super@example.com', 'admin');
      expect(result).toBe(true);
    });

    it('should return true when user role meets requirement', async () => {
      (prisma.storeAdmin.findUnique as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        role: 'admin',
      });

      const result = await adminService.hasRole('store-123', 'admin@example.com', 'product_editor');
      expect(result).toBe(true);
    });

    it('should return false when user role is insufficient', async () => {
      (prisma.storeAdmin.findUnique as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        role: 'viewer',
      });

      const result = await adminService.hasRole('store-123', 'admin@example.com', 'admin');
      expect(result).toBe(false);
    });

    it('should return false for non-admin', async () => {
      (prisma.storeAdmin.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await adminService.hasRole('store-123', 'unknown@example.com', 'viewer');
      expect(result).toBe(false);
    });
  });

  describe('getAllAdmins', () => {
    it('should return all admins for a store', async () => {
      const mockAdmins = [
        mockStoreAdmin,
        { ...mockStoreAdmin, id: 'admin-2', email: 'admin2@example.com' },
      ];
      (prisma.storeAdmin.findMany as jest.Mock).mockResolvedValue(mockAdmins);

      const result = await adminService.getAllAdmins('store-123');
      expect(result).toEqual(mockAdmins);
      expect(prisma.storeAdmin.findMany).toHaveBeenCalledWith({
        where: { storeId: 'store-123' },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('getAdminById', () => {
    it('should return admin by ID', async () => {
      (prisma.storeAdmin.findFirst as jest.Mock).mockResolvedValue(mockStoreAdmin);

      const result = await adminService.getAdminById('store-123', 'admin-1');
      expect(result).toEqual(mockStoreAdmin);
      expect(prisma.storeAdmin.findFirst).toHaveBeenCalledWith({
        where: { id: 'admin-1', storeId: 'store-123' },
      });
    });

    it('should return null for non-existent admin', async () => {
      (prisma.storeAdmin.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await adminService.getAdminById('store-123', 'unknown');
      expect(result).toBeNull();
    });
  });

  describe('addAdmin', () => {
    it('should create a new admin with default role', async () => {
      (prisma.storeAdmin.create as jest.Mock).mockResolvedValue(mockStoreAdmin);

      const result = await adminService.addAdmin('store-123', 'newadmin@example.com');
      expect(result).toEqual(mockStoreAdmin);
      expect(prisma.storeAdmin.create).toHaveBeenCalledWith({
        data: {
          storeId: 'store-123',
          email: 'newadmin@example.com',
          role: 'admin',
          isActive: true,
          createdBy: undefined,
        },
      });
    });

    it('should create admin with specified role and createdBy', async () => {
      (prisma.storeAdmin.create as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        role: 'viewer',
      });

      await adminService.addAdmin('store-123', 'viewer@example.com', 'viewer', 'creator@test.com');
      expect(prisma.storeAdmin.create).toHaveBeenCalledWith({
        data: {
          storeId: 'store-123',
          email: 'viewer@example.com',
          role: 'viewer',
          isActive: true,
          createdBy: 'creator@test.com',
        },
      });
    });

    it('should normalize email to lowercase', async () => {
      (prisma.storeAdmin.create as jest.Mock).mockResolvedValue(mockStoreAdmin);

      await adminService.addAdmin('store-123', '  ADMIN@EXAMPLE.COM  ');
      expect(prisma.storeAdmin.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'admin@example.com',
        }),
      });
    });
  });

  describe('updateAdminRole', () => {
    it('should update admin role', async () => {
      (prisma.storeAdmin.findFirst as jest.Mock).mockResolvedValue(mockStoreAdmin);
      (prisma.storeAdmin.update as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        role: 'viewer',
      });

      const result = await adminService.updateAdminRole('store-123', 'admin-1', 'viewer');
      expect(result?.role).toBe('viewer');
      expect(prisma.storeAdmin.update).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { role: 'viewer' },
      });
    });

    it('should return null for non-existent admin', async () => {
      (prisma.storeAdmin.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await adminService.updateAdminRole('store-123', 'unknown', 'viewer');
      expect(result).toBeNull();
      expect(prisma.storeAdmin.update).not.toHaveBeenCalled();
    });
  });

  describe('toggleAdminActive', () => {
    it('should toggle admin from active to inactive', async () => {
      (prisma.storeAdmin.findFirst as jest.Mock).mockResolvedValue(mockStoreAdmin);
      (prisma.storeAdmin.update as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        isActive: false,
      });

      const result = await adminService.toggleAdminActive('store-123', 'admin-1');
      expect(result?.isActive).toBe(false);
      expect(prisma.storeAdmin.update).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { isActive: false },
      });
    });

    it('should toggle admin from inactive to active', async () => {
      (prisma.storeAdmin.findFirst as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        isActive: false,
      });
      (prisma.storeAdmin.update as jest.Mock).mockResolvedValue({
        ...mockStoreAdmin,
        isActive: true,
      });

      const result = await adminService.toggleAdminActive('store-123', 'admin-1');
      expect(result?.isActive).toBe(true);
    });

    it('should return null for non-existent admin', async () => {
      (prisma.storeAdmin.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await adminService.toggleAdminActive('store-123', 'unknown');
      expect(result).toBeNull();
    });
  });

  describe('removeAdmin', () => {
    it('should delete admin and return true', async () => {
      (prisma.storeAdmin.findFirst as jest.Mock).mockResolvedValue(mockStoreAdmin);
      (prisma.storeAdmin.delete as jest.Mock).mockResolvedValue(mockStoreAdmin);

      const result = await adminService.removeAdmin('store-123', 'admin-1');
      expect(result).toBe(true);
      expect(prisma.storeAdmin.delete).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
      });
    });

    it('should return false for non-existent admin', async () => {
      (prisma.storeAdmin.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await adminService.removeAdmin('store-123', 'unknown');
      expect(result).toBe(false);
      expect(prisma.storeAdmin.delete).not.toHaveBeenCalled();
    });
  });

  describe('getSuperAdminEmails', () => {
    it('should return env-based admin emails', () => {
      const result = adminService.getSuperAdminEmails();
      expect(result).toEqual(['super@example.com', 'superadmin@test.com']);
    });
  });

  describe('isSuperAdmin', () => {
    it('should return true for env-based admin', () => {
      expect(adminService.isSuperAdmin('super@example.com')).toBe(true);
      expect(adminService.isSuperAdmin('superadmin@test.com')).toBe(true);
    });

    it('should return false for non-super admin', () => {
      expect(adminService.isSuperAdmin('regular@example.com')).toBe(false);
    });

    it('should handle case insensitivity', () => {
      expect(adminService.isSuperAdmin('SUPER@EXAMPLE.COM')).toBe(true);
    });
  });
});
