export interface Product {
  id: string;
  name: string;
  description: string;
  price: number; // in cents
  currency: string;
  image?: string;
  category: string;
}

export const products: Product[] = [
  {
    id: 'prod-001',
    name: 'Wireless Headphones',
    description: 'Premium noise-cancelling wireless headphones with 30-hour battery life.',
    price: 14999,
    currency: 'CAD',
    category: 'Electronics',
  },
  {
    id: 'prod-002',
    name: 'Smart Watch',
    description: 'Fitness tracking smartwatch with heart rate monitor and GPS.',
    price: 29999,
    currency: 'CAD',
    category: 'Electronics',
  },
  {
    id: 'prod-003',
    name: 'Bluetooth Speaker',
    description: 'Portable waterproof speaker with 360-degree sound.',
    price: 7999,
    currency: 'CAD',
    category: 'Electronics',
  },
  {
    id: 'prod-004',
    name: 'Coffee Maker',
    description: 'Programmable 12-cup coffee maker with thermal carafe.',
    price: 8999,
    currency: 'CAD',
    category: 'Home',
  },
  {
    id: 'prod-005',
    name: 'Running Shoes',
    description: 'Lightweight running shoes with responsive cushioning.',
    price: 12999,
    currency: 'CAD',
    category: 'Sports',
  },
  {
    id: 'prod-006',
    name: 'Backpack',
    description: 'Durable laptop backpack with USB charging port.',
    price: 5999,
    currency: 'CAD',
    category: 'Accessories',
  },
];

export function getProductById(id: string): Product | undefined {
  return products.find(p => p.id === id);
}

export function getAllProducts(): Product[] {
  return products;
}

export function formatPrice(cents: number, currency: string = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}
