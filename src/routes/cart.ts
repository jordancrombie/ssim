import { Router, Request, Response } from 'express';
import { getProductById, formatPrice } from '../data/products';
import '../types/session';

const router = Router();

// Get cart contents
router.get('/', (req: Request, res: Response) => {
  const cart = req.session.cart || [];
  const items = cart.map(item => {
    const product = getProductById(item.productId);
    return {
      ...item,
      product,
      subtotal: product ? product.price * item.quantity : 0,
    };
  }).filter(item => item.product);

  const total = items.reduce((sum, item) => sum + item.subtotal, 0);

  res.json({
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    total,
    formattedTotal: formatPrice(total),
  });
});

// Add item to cart
router.post('/add', (req: Request, res: Response) => {
  const { productId, quantity = 1 } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'Product ID is required' });
  }

  const product = getProductById(productId);
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
