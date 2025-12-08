import { Router, Request, Response } from 'express';
import { getOrCreateStore } from '../services/store';
import * as productService from '../services/product';
import type { Store } from '@prisma/client';
import '../types/session';

const router = Router();

// Store reference (cached for request lifecycle)
let currentStore: Store | null = null;

async function ensureStore(): Promise<Store> {
  if (!currentStore) {
    currentStore = await getOrCreateStore();
  }
  return currentStore;
}

// Get cart contents
router.get('/', async (req: Request, res: Response) => {
  try {
    const store = await ensureStore();
    const cart = req.session.cart || [];

    // Fetch products for all cart items
    const itemsWithProducts = await Promise.all(
      cart.map(async (item) => {
        const product = await productService.getProductById(store.id, item.productId);
        return {
          ...item,
          product,
          subtotal: product ? product.price * item.quantity : 0,
        };
      })
    );

    const items = itemsWithProducts.filter(item => item.product);
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);

    res.json({
      items,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      total,
      formattedTotal: productService.formatPrice(total),
    });
  } catch (error) {
    console.error('[Cart] Get error:', error);
    res.status(500).json({ error: 'Failed to get cart' });
  }
});

// Add item to cart
router.post('/add', async (req: Request, res: Response) => {
  const { productId, quantity = 1 } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'Product ID is required' });
  }

  try {
    const store = await ensureStore();
    const product = await productService.getProductById(store.id, productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const cart = req.session.cart || [];
    const existingItem = cart.find(item => item.productId === productId);

    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.push({ productId, quantity });
    }

    req.session.cart = cart;

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Failed to save cart' });
      }

      const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
      res.json({
        success: true,
        message: `${product.name} added to cart`,
        itemCount,
      });
    });
  } catch (error) {
    console.error('[Cart] Add error:', error);
    res.status(500).json({ error: 'Failed to add to cart' });
  }
});

// Update item quantity
router.put('/update', (req: Request, res: Response) => {
  const { productId, quantity } = req.body;

  if (!productId || quantity === undefined) {
    return res.status(400).json({ error: 'Product ID and quantity are required' });
  }

  const cart = req.session.cart || [];
  const itemIndex = cart.findIndex(item => item.productId === productId);

  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Item not in cart' });
  }

  if (quantity <= 0) {
    cart.splice(itemIndex, 1);
  } else {
    cart[itemIndex].quantity = quantity;
  }

  req.session.cart = cart;

  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).json({ error: 'Failed to save cart' });
    }

    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    res.json({
      success: true,
      itemCount,
    });
  });
});

// Remove item from cart
router.delete('/remove/:productId', (req: Request, res: Response) => {
  const { productId } = req.params;

  const cart = req.session.cart || [];
  const itemIndex = cart.findIndex(item => item.productId === productId);

  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Item not in cart' });
  }

  cart.splice(itemIndex, 1);
  req.session.cart = cart;

  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).json({ error: 'Failed to save cart' });
    }

    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    res.json({
      success: true,
      itemCount,
    });
  });
});

// Clear cart
router.post('/clear', (req: Request, res: Response) => {
  req.session.cart = [];

  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).json({ error: 'Failed to clear cart' });
    }

    res.json({
      success: true,
      itemCount: 0,
    });
  });
});

export default router;
