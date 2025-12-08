import prisma from '../lib/prisma';
import { config } from '../config/env';
import type { StoreAdmin } from '@prisma/client';

// Re-export the Prisma StoreAdmin type
export type { StoreAdmin };

// Admin role types
export type AdminRole = 'admin' | 'product_editor' | 'order_manager' | 'viewer';

// Role hierarchy for permission checking
const roleHierarchy: Record<AdminRole, number> = {
  admin: 100,
  product_editor: 50,
  order_manager: 50,
  viewer: 10,
};

/**
 * Check if a user is an admin (either from env config or database)
 * This provides backward compatibility with ADMIN_EMAILS env var
 */
export async function isAdmin(storeId: string, email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();

  // Check env-based admin list first (super admins)
  if (config.adminEmails?.includes(normalizedEmail)) {
    return true;
  }

  // Check database for store-specific admin
  const admin = await prisma.storeAdmin.findUnique({
    where: {
      storeId_email: {
        storeId,
        email: normalizedEmail,
      },
    },
  });

  return admin?.isActive === true;
}

/**
 * Get admin role for a user (returns 'super' for env-based admins)
 */
export async function getAdminRole(storeId: string, email: string): Promise<AdminRole | 'super' | null> {
  const normalizedEmail = email.toLowerCase().trim();

  // Env-based admins are super admins
  if (config.adminEmails?.includes(normalizedEmail)) {
    return 'super';
  }

  // Check database
  const admin = await prisma.storeAdmin.findUnique({
    where: {
      storeId_email: {
        storeId,
        email: normalizedEmail,
      },
    },
  });

  if (!admin?.isActive) return null;

  return admin.role as AdminRole;
}

/**
 * Check if user has at least a certain role level
 */
export async function hasRole(storeId: string, email: string, requiredRole: AdminRole): Promise<boolean> {
  const role = await getAdminRole(storeId, email);

  if (!role) return false;
  if (role === 'super') return true; // Super admins can do everything

  const userLevel = roleHierarchy[role] || 0;
  const requiredLevel = roleHierarchy[requiredRole] || 0;

  return userLevel >= requiredLevel;
}

/**
 * Get all admins for a store
 */
export async function getAllAdmins(storeId: string): Promise<StoreAdmin[]> {
  return prisma.storeAdmin.findMany({
    where: { storeId },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });
}

/**
 * Get admin by ID
 */
export async function getAdminById(storeId: string, adminId: string): Promise<StoreAdmin | null> {
  return prisma.storeAdmin.findFirst({
    where: {
      id: adminId,
      storeId,
    },
  });
}

/**
 * Add a new admin
 */
export async function addAdmin(
  storeId: string,
  email: string,
  role: AdminRole = 'admin',
  createdBy?: string
): Promise<StoreAdmin> {
  const normalizedEmail = email.toLowerCase().trim();

  return prisma.storeAdmin.create({
    data: {
      storeId,
      email: normalizedEmail,
      role,
      isActive: true,
      createdBy,
    },
  });
}

/**
 * Update admin role
 */
export async function updateAdminRole(
  storeId: string,
  adminId: string,
  role: AdminRole
): Promise<StoreAdmin | null> {
  const existing = await prisma.storeAdmin.findFirst({
    where: { id: adminId, storeId },
  });

  if (!existing) return null;

  return prisma.storeAdmin.update({
    where: { id: adminId },
    data: { role },
  });
}

/**
 * Toggle admin active status
 */
export async function toggleAdminActive(storeId: string, adminId: string): Promise<StoreAdmin | null> {
  const existing = await prisma.storeAdmin.findFirst({
    where: { id: adminId, storeId },
  });

  if (!existing) return null;

  return prisma.storeAdmin.update({
    where: { id: adminId },
    data: { isActive: !existing.isActive },
  });
}

/**
 * Remove an admin
 */
export async function removeAdmin(storeId: string, adminId: string): Promise<boolean> {
  const existing = await prisma.storeAdmin.findFirst({
    where: { id: adminId, storeId },
  });

  if (!existing) return false;

  await prisma.storeAdmin.delete({
    where: { id: adminId },
  });

  return true;
}

/**
 * Get env-based super admins (for display/reference)
 */
export function getSuperAdminEmails(): string[] {
  return config.adminEmails || [];
}

/**
 * Check if email is a super admin (env-based)
 */
export function isSuperAdmin(email: string): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  return config.adminEmails?.includes(normalizedEmail) || false;
}
