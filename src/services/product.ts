import prisma from '../lib/prisma';
import type { Product } from '@prisma/client';

// Re-export the Prisma Product type
export type { Product };

export interface CreateProductParams {
  name: string;
  description: string;
  price: number;
  currency?: string;
  image?: string;
  category: string;
}

export interface UpdateProductParams {
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  image?: string;
  category?: string;
  isActive?: boolean;
}

// Default products to seed when store has none
const defaultProducts: Omit<CreateProductParams, 'currency'>[] = [
  {
    name: 'Wireless Headphones',
    description: 'Premium noise-cancelling wireless headphones with 30-hour battery life.',
    price: 14999,
    category: 'Electronics',
  },
  {
    name: 'Smart Watch',
    description: 'Fitness tracking smartwatch with heart rate monitor and GPS.',
    price: 29999,
    category: 'Electronics',
  },
  {
    name: 'Bluetooth Speaker',
    description: 'Portable waterproof speaker with 360-degree sound.',
    price: 7999,
    category: 'Electronics',
  },
  {
    name: 'Coffee Maker',
    description: 'Programmable 12-cup coffee maker with thermal carafe.',
    price: 8999,
    category: 'Home',
  },
  {
    name: 'Running Shoes',
    description: 'Lightweight running shoes with responsive cushioning.',
    price: 12999,
    category: 'Sports',
  },
  {
    name: 'Backpack',
    description: 'Durable laptop backpack with USB charging port.',
    price: 5999,
    category: 'Accessories',
  },
];

/**
 * Seed default products for a store if none exist
 */
export async function seedDefaultProducts(storeId: string): Promise<void> {
  const count = await prisma.product.count({ where: { storeId } });

  if (count === 0) {
    console.log(`[Product] Seeding default products for store ${storeId}`);
    await prisma.product.createMany({
      data: defaultProducts.map(p => ({
        storeId,
        ...p,
        currency: 'CAD',
      })),
    });
  }
}

/**
 * Get a product by ID
 */
export async function getProductById(storeId: string, productId: string): Promise<Product | null> {
  return prisma.product.findFirst({
    where: {
      id: productId,
      storeId,
    },
  });
}

/**
 * Get all products for a store
 */
export async function getAllProducts(storeId: string, includeInactive = false): Promise<Product[]> {
  const where: any = { storeId };
  if (!includeInactive) {
    where.isActive = true;
  }

  return prisma.product.findMany({
    where,
    orderBy: { name: 'asc' },
  });
}

/**
 * Get products by category
 */
export async function getProductsByCategory(storeId: string, category: string): Promise<Product[]> {
  return prisma.product.findMany({
    where: {
      storeId,
      category,
      isActive: true,
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Get all unique categories for a store
 */
export async function getCategories(storeId: string): Promise<string[]> {
  const products = await prisma.product.findMany({
    where: {
      storeId,
      isActive: true,
    },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });

  return products.map(p => p.category);
}

/**
 * Create a new product
 */
export async function createProduct(storeId: string, params: CreateProductParams): Promise<Product> {
  return prisma.product.create({
    data: {
      storeId,
      name: params.name,
      description: params.description,
      price: params.price,
      currency: params.currency || 'CAD',
      image: params.image,
      category: params.category,
      isActive: true,
    },
  });
}

/**
 * Update a product
 */
export async function updateProduct(
  storeId: string,
  productId: string,
  params: UpdateProductParams
): Promise<Product | null> {
  // First check if product exists and belongs to store
  const existing = await prisma.product.findFirst({
    where: { id: productId, storeId },
  });

  if (!existing) return null;

  return prisma.product.update({
    where: { id: productId },
    data: params,
  });
}

/**
 * Delete a product
 */
export async function deleteProduct(storeId: string, productId: string): Promise<boolean> {
  // First check if product exists and belongs to store
  const existing = await prisma.product.findFirst({
    where: { id: productId, storeId },
  });

  if (!existing) return false;

  await prisma.product.delete({
    where: { id: productId },
  });

  return true;
}

/**
 * Toggle product active status
 */
export async function toggleProductActive(storeId: string, productId: string): Promise<Product | null> {
  // First check if product exists and belongs to store
  const existing = await prisma.product.findFirst({
    where: { id: productId, storeId },
  });

  if (!existing) return null;

  return prisma.product.update({
    where: { id: productId },
    data: { isActive: !existing.isActive },
  });
}

/**
 * Get product stats for admin dashboard
 */
export async function getProductStats(storeId: string): Promise<{
  total: number;
  active: number;
  categories: number;
}> {
  const [total, active, categoriesResult] = await Promise.all([
    prisma.product.count({ where: { storeId } }),
    prisma.product.count({ where: { storeId, isActive: true } }),
    prisma.product.findMany({
      where: { storeId, isActive: true },
      select: { category: true },
      distinct: ['category'],
    }),
  ]);

  return {
    total,
    active,
    categories: categoriesResult.length,
  };
}

/**
 * Format price for display
 */
export function formatPrice(cents: number, currency: string = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}
