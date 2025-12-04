import { randomUUID } from 'crypto';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number; // in cents
  currency: string;
  image?: string;
  category: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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

// In-memory product storage
const products: Map<string, Product> = new Map();

// Initialize with default products
const defaultProducts: Omit<Product, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'prod-001',
    name: 'Wireless Headphones',
    description: 'Premium noise-cancelling wireless headphones with 30-hour battery life.',
    price: 14999,
    currency: 'CAD',
    category: 'Electronics',
    isActive: true,
  },
  {
    id: 'prod-002',
    name: 'Smart Watch',
    description: 'Fitness tracking smartwatch with heart rate monitor and GPS.',
    price: 29999,
    currency: 'CAD',
    category: 'Electronics',
    isActive: true,
  },
  {
    id: 'prod-003',
    name: 'Bluetooth Speaker',
    description: 'Portable waterproof speaker with 360-degree sound.',
    price: 7999,
    currency: 'CAD',
    category: 'Electronics',
    isActive: true,
  },
  {
    id: 'prod-004',
    name: 'Coffee Maker',
    description: 'Programmable 12-cup coffee maker with thermal carafe.',
    price: 8999,
    currency: 'CAD',
    category: 'Home',
    isActive: true,
  },
  {
    id: 'prod-005',
    name: 'Running Shoes',
    description: 'Lightweight running shoes with responsive cushioning.',
    price: 12999,
    currency: 'CAD',
    category: 'Sports',
    isActive: true,
  },
  {
    id: 'prod-006',
    name: 'Backpack',
    description: 'Durable laptop backpack with USB charging port.',
    price: 5999,
    currency: 'CAD',
    category: 'Accessories',
    isActive: true,
  },
];

// Initialize products on module load
function initializeProducts(): void {
  const now = new Date();
  for (const p of defaultProducts) {
    products.set(p.id, {
      ...p,
      createdAt: now,
      updatedAt: now,
    });
  }
}

initializeProducts();

// Query functions
export function getProductById(id: string): Product | undefined {
  return products.get(id);
}

export function getAllProducts(includeInactive = false): Product[] {
  const all = Array.from(products.values());
  if (includeInactive) {
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }
  return all.filter(p => p.isActive).sort((a, b) => a.name.localeCompare(b.name));
}

export function getProductsByCategory(category: string): Product[] {
  return Array.from(products.values())
    .filter(p => p.isActive && p.category === category)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getCategories(): string[] {
  const categories = new Set<string>();
  for (const p of products.values()) {
    if (p.isActive) {
      categories.add(p.category);
    }
  }
  return Array.from(categories).sort();
}

// CRUD functions for admin
export function createProduct(params: CreateProductParams): Product {
  const id = `prod-${randomUUID()}`;
  const now = new Date();

  const product: Product = {
    id,
    name: params.name,
    description: params.description,
    price: params.price,
    currency: params.currency || 'CAD',
    image: params.image,
    category: params.category,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  products.set(id, product);
  return product;
}

export function updateProduct(id: string, params: UpdateProductParams): Product | undefined {
  const product = products.get(id);
  if (!product) return undefined;

  const updated: Product = {
    ...product,
    ...params,
    updatedAt: new Date(),
  };

  products.set(id, updated);
  return updated;
}

export function deleteProduct(id: string): boolean {
  return products.delete(id);
}

export function toggleProductActive(id: string): Product | undefined {
  const product = products.get(id);
  if (!product) return undefined;

  product.isActive = !product.isActive;
  product.updatedAt = new Date();
  products.set(id, product);
  return product;
}

// Utility functions
export function formatPrice(cents: number, currency: string = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

// Stats for admin dashboard
export function getProductStats(): { total: number; active: number; categories: number } {
  const all = Array.from(products.values());
  const active = all.filter(p => p.isActive);
  const categories = new Set(active.map(p => p.category));

  return {
    total: all.length,
    active: active.length,
    categories: categories.size,
  };
}
