import prisma from '../lib/prisma';
import { config } from '../config/env';
import type { Store, StoreUser } from '@prisma/client';
import { seedDefaultProducts } from './product';

/**
 * Store branding information
 */
export interface StoreBranding {
  name: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  heroImageUrl: string | null;
  themePreset: string;
  envBadge: string | null;
}

/**
 * Get or create the store record for this SSIM instance
 * Also seeds default products if the store is new
 */
export async function getOrCreateStore(): Promise<Store> {
  const { storeDomain, storeName } = config;

  let store = await prisma.store.findUnique({
    where: { domain: storeDomain },
  });

  if (!store) {
    console.log(`[Store] Creating new store: ${storeName} (${storeDomain})`);
    store = await prisma.store.create({
      data: {
        domain: storeDomain,
        name: storeName,
      },
    });

    // Seed default products for new store
    try {
      await seedDefaultProducts(store.id);
    } catch (err) {
      console.error('[Store] Failed to seed default products:', err);
    }
  }

  return store;
}

/**
 * Get or create a user record for this store
 */
export async function getOrCreateStoreUser(
  storeId: string,
  bsimUserId: string,
  email: string,
  name?: string
): Promise<StoreUser> {
  let user = await prisma.storeUser.findUnique({
    where: {
      storeId_bsimUserId: {
        storeId,
        bsimUserId,
      },
    },
  });

  if (!user) {
    console.log(`[Store] Creating new user: ${email} (${bsimUserId})`);
    user = await prisma.storeUser.create({
      data: {
        storeId,
        bsimUserId,
        email,
        name,
      },
    });
  } else {
    // Update last login time and potentially name/email if changed
    user = await prisma.storeUser.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        email,
        name: name || user.name,
      },
    });
  }

  return user;
}

/**
 * Get a store user by BSIM user ID
 */
export async function getStoreUserByBsimId(
  storeId: string,
  bsimUserId: string
): Promise<StoreUser | null> {
  return prisma.storeUser.findUnique({
    where: {
      storeId_bsimUserId: {
        storeId,
        bsimUserId,
      },
    },
  });
}

/**
 * Update user's consented scopes
 */
export async function updateConsentedScopes(
  userId: string,
  scopes: string[]
): Promise<StoreUser> {
  return prisma.storeUser.update({
    where: { id: userId },
    data: {
      consentedScopes: scopes,
    },
  });
}

/**
 * Check if user has already consented to the requested scopes
 */
export function hasConsentedToScopes(
  user: StoreUser,
  requestedScopes: string[]
): boolean {
  const consented = new Set(user.consentedScopes);
  return requestedScopes.every(scope => consented.has(scope));
}

/**
 * Update user's WSIM JWT token
 */
export async function updateWsimJwt(
  userId: string,
  wsimJwt: string,
  wsimJwtExp: Date
): Promise<StoreUser> {
  return prisma.storeUser.update({
    where: { id: userId },
    data: {
      wsimJwt,
      wsimJwtExp,
    },
  });
}

/**
 * Clear user's WSIM JWT token (on logout or expiry)
 */
export async function clearWsimJwt(userId: string): Promise<StoreUser> {
  return prisma.storeUser.update({
    where: { id: userId },
    data: {
      wsimJwt: null,
      wsimJwtExp: null,
    },
  });
}

/**
 * Get user's valid WSIM JWT if present and not expired
 */
export function getValidWsimJwt(user: StoreUser): string | null {
  if (!user.wsimJwt || !user.wsimJwtExp) {
    return null;
  }

  if (new Date() > user.wsimJwtExp) {
    return null; // Token expired
  }

  return user.wsimJwt;
}

// ============================================
// Store Branding Functions
// ============================================

/**
 * Get store branding information
 * Falls back to env config for name if not set in DB
 */
export async function getStoreBranding(storeId: string): Promise<StoreBranding | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      name: true,
      tagline: true,
      description: true,
      logoUrl: true,
      heroImageUrl: true,
      themePreset: true,
      envBadge: true,
    },
  });

  if (!store) {
    return null;
  }

  return {
    name: store.name || config.storeName,
    tagline: store.tagline,
    description: store.description,
    logoUrl: store.logoUrl,
    heroImageUrl: store.heroImageUrl,
    themePreset: store.themePreset || 'default',
    envBadge: store.envBadge,
  };
}

/**
 * Update store branding information
 */
export async function updateStoreBranding(
  storeId: string,
  data: Partial<StoreBranding>
): Promise<Store> {
  return prisma.store.update({
    where: { id: storeId },
    data: {
      name: data.name,
      tagline: data.tagline,
      description: data.description,
      logoUrl: data.logoUrl,
      heroImageUrl: data.heroImageUrl,
      themePreset: data.themePreset,
      envBadge: data.envBadge,
    },
  });
}

/**
 * Get store by ID with full details
 */
export async function getStoreById(storeId: string): Promise<Store | null> {
  return prisma.store.findUnique({
    where: { id: storeId },
  });
}

// ============================================
// Payment Method Settings
// ============================================

/**
 * Payment method configuration for a store
 */
export interface PaymentMethodSettings {
  bankPaymentEnabled: boolean;
  walletRedirectEnabled: boolean;
  walletPopupEnabled: boolean;
  walletInlineEnabled: boolean;
  walletQuickCheckoutEnabled: boolean;
  walletApiEnabled: boolean;
  walletMobileEnabled: boolean;
}

/**
 * Default payment method settings
 */
const DEFAULT_PAYMENT_SETTINGS: PaymentMethodSettings = {
  bankPaymentEnabled: true,
  walletRedirectEnabled: true,
  walletPopupEnabled: true,
  walletInlineEnabled: true,
  walletQuickCheckoutEnabled: true,
  walletApiEnabled: true,
  walletMobileEnabled: true,
};

/**
 * Get payment method settings for a store
 */
export async function getPaymentMethodSettings(storeId: string): Promise<PaymentMethodSettings> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      bankPaymentEnabled: true,
      walletRedirectEnabled: true,
      walletPopupEnabled: true,
      walletInlineEnabled: true,
      walletQuickCheckoutEnabled: true,
      walletApiEnabled: true,
      walletMobileEnabled: true,
    },
  });

  if (!store) {
    return DEFAULT_PAYMENT_SETTINGS;
  }

  return {
    bankPaymentEnabled: store.bankPaymentEnabled,
    walletRedirectEnabled: store.walletRedirectEnabled,
    walletPopupEnabled: store.walletPopupEnabled,
    walletInlineEnabled: store.walletInlineEnabled,
    walletQuickCheckoutEnabled: store.walletQuickCheckoutEnabled,
    walletApiEnabled: store.walletApiEnabled,
    walletMobileEnabled: store.walletMobileEnabled,
  };
}

/**
 * Update payment method settings for a store
 */
export async function updatePaymentMethodSettings(
  storeId: string,
  settings: Partial<PaymentMethodSettings>
): Promise<Store> {
  return prisma.store.update({
    where: { id: storeId },
    data: {
      bankPaymentEnabled: settings.bankPaymentEnabled,
      walletRedirectEnabled: settings.walletRedirectEnabled,
      walletPopupEnabled: settings.walletPopupEnabled,
      walletInlineEnabled: settings.walletInlineEnabled,
      walletQuickCheckoutEnabled: settings.walletQuickCheckoutEnabled,
      walletApiEnabled: settings.walletApiEnabled,
    },
  });
}
