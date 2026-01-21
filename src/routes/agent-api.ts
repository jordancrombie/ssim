/**
 * Agent Commerce API Routes
 * Implements SimToolBox Agent Commerce Protocol (SACP) for SSIM
 *
 * Endpoints:
 * - GET /.well-known/ucp - UCP Discovery
 * - GET /api/agent/v1/products - List products
 * - GET /api/agent/v1/products/:id - Get product details
 * - GET /api/agent/v1/products/search - Search products
 * - POST /api/agent/v1/sessions - Create checkout session
 * - GET /api/agent/v1/sessions/:id - Get session
 * - PATCH /api/agent/v1/sessions/:id - Update session
 * - POST /api/agent/v1/sessions/:id/complete - Complete checkout
 * - DELETE /api/agent/v1/sessions/:id - Cancel session
 */

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { config } from '../config/env';
import { authenticateAgent, optionalAgentAuth } from '../middleware/agent-auth';
import { getOrCreateStore } from '../services/store';
import { requestPaymentToken } from '../services/wsim-agent';

const router = Router();

// ============================================
// Store Context Middleware
// ============================================

/**
 * Middleware to load store context for all agent requests
 */
async function loadStoreContext(req: Request, res: Response, next: Function) {
  try {
    const store = await getOrCreateStore();
    req.storeId = store.id;
    next();
  } catch (error) {
    console.error('[Agent API] Failed to load store context:', error);
    res.status(500).json({ error: 'Failed to load store context' });
  }
}

// Apply store context to all routes
router.use(loadStoreContext);

// ============================================
// UCP Discovery Endpoint
// ============================================

/**
 * GET /.well-known/ucp
 * Returns store capabilities for agent discovery
 * No authentication required - public endpoint
 */
router.get('/ucp', async (req: Request, res: Response) => {
  try {
    const store = await prisma.store.findUnique({
      where: { id: req.storeId },
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const ucpProfile = {
      version: '1.0',
      merchant: {
        id: `ssim_${store.domain.replace(/\./g, '_')}`,
        name: store.name,
        description: store.description || `Welcome to ${store.name}`,
        logo: store.logoUrl
          ? `${config.appBaseUrl}${store.logoUrl}`
          : `${config.appBaseUrl}/logo.png`,
        url: config.appBaseUrl,
      },
      capabilities: {
        discovery: true,
        cart: true,
        checkout: true,
        order_status: true,
        returns: false, // Not implemented in MVP
      },
      api: {
        base_url: `${config.appBaseUrl}/api/agent/v1`,
        authentication: 'bearer',
        endpoints: {
          products: '/products',
          sessions: '/sessions',
          orders: '/orders',
        },
      },
      payment_methods: {
        supported: ['card', 'wallet'],
        wallets: ['wsim'],
      },
      policies: {
        terms: `${config.appBaseUrl}/terms`,
        privacy: `${config.appBaseUrl}/privacy`,
      },
      session_config: {
        expiration_minutes: config.agentSessionExpirationMinutes,
        expiration_range: { min: 5, max: 60 },
      },
    };

    // Cache for 5 minutes
    res.set('Cache-Control', 'public, max-age=300');
    res.json(ucpProfile);
  } catch (error) {
    console.error('[Agent API] UCP endpoint error:', error);
    res.status(500).json({ error: 'Failed to generate UCP profile' });
  }
});

// ============================================
// Product Catalog API
// ============================================

/**
 * GET /api/agent/v1/products
 * List products with pagination
 * Optional agent authentication
 */
router.get('/products', optionalAgentAuth, async (req: Request, res: Response) => {
  try {
    const {
      limit = '20',
      offset = '0',
      category,
      inStock,
      minPrice,
      maxPrice,
    } = req.query;

    const where: any = {
      storeId: req.storeId,
      isActive: true,
    };

    if (category) {
      where.category = String(category);
    }

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseInt(String(minPrice), 10);
      if (maxPrice) where.price.lte = parseInt(String(maxPrice), 10);
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        take: Math.min(parseInt(String(limit), 10), 100),
        skip: parseInt(String(offset), 10),
        orderBy: { name: 'asc' },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      products: products.map(formatProduct),
      pagination: {
        total,
        limit: parseInt(String(limit), 10),
        offset: parseInt(String(offset), 10),
        hasMore: parseInt(String(offset), 10) + products.length < total,
      },
    });
  } catch (error) {
    console.error('[Agent API] List products error:', error);
    res.status(500).json({ error: 'Failed to list products' });
  }
});

/**
 * GET /api/agent/v1/products/search
 * Search products by query
 */
router.get('/products/search', optionalAgentAuth, async (req: Request, res: Response) => {
  try {
    const { q, limit = '20', offset = '0' } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    const searchQuery = String(q).toLowerCase();

    const where: any = {
      storeId: req.storeId,
      isActive: true,
      OR: [
        { name: { contains: searchQuery, mode: 'insensitive' } },
        { description: { contains: searchQuery, mode: 'insensitive' } },
        { category: { contains: searchQuery, mode: 'insensitive' } },
      ],
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        take: Math.min(parseInt(String(limit), 10), 100),
        skip: parseInt(String(offset), 10),
        orderBy: { name: 'asc' },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      products: products.map(formatProduct),
      query: q,
      pagination: {
        total,
        limit: parseInt(String(limit), 10),
        offset: parseInt(String(offset), 10),
        hasMore: parseInt(String(offset), 10) + products.length < total,
      },
    });
  } catch (error) {
    console.error('[Agent API] Search products error:', error);
    res.status(500).json({ error: 'Failed to search products' });
  }
});

/**
 * GET /api/agent/v1/products/:id
 * Get product details
 */
router.get('/products/:id', optionalAgentAuth, async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findFirst({
      where: {
        id: req.params.id,
        storeId: req.storeId,
        isActive: true,
      },
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(formatProduct(product));
  } catch (error) {
    console.error('[Agent API] Get product error:', error);
    res.status(500).json({ error: 'Failed to get product' });
  }
});

/**
 * Format product for API response
 */
function formatProduct(product: any) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: {
      amount: product.price / 100, // Convert cents to dollars
      currency: product.currency,
    },
    images: product.image
      ? [{ url: product.image, alt: product.name }]
      : [],
    inventory: {
      available: true, // SSIM doesn't track inventory in MVP
      quantity: null,
    },
    categories: [product.category],
    schema_org: {
      '@type': 'Product',
      name: product.name,
      description: product.description,
      image: product.image,
      offers: {
        '@type': 'Offer',
        price: (product.price / 100).toFixed(2),
        priceCurrency: product.currency,
        availability: 'https://schema.org/InStock',
      },
    },
  };
}

// ============================================
// Checkout Session API
// ============================================

/**
 * POST /api/agent/v1/sessions
 * Create a new checkout session
 * Requires agent authentication
 */
router.post('/sessions', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    // Validate items and fetch product details
    const productIds = items.map((item: any) => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        storeId: req.storeId,
        isActive: true,
      },
    });

    if (products.length !== productIds.length) {
      const foundIds = products.map((p) => p.id);
      const missingIds = productIds.filter((id: string) => !foundIds.includes(id));
      return res.status(400).json({
        error: 'item_unavailable',
        message: 'Some products are not available',
        unavailableItems: missingIds,
      });
    }

    // Build cart
    const cartItems = items.map((item: any) => {
      const product = products.find((p) => p.id === item.productId)!;
      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
      return {
        productId: product.id,
        name: product.name,
        quantity,
        unitPrice: product.price,
        subtotal: product.price * quantity,
      };
    });

    const subtotal = cartItems.reduce((sum: number, item: any) => sum + item.subtotal, 0);
    const tax = Math.round(subtotal * 0.13); // 13% HST for Ontario
    const total = subtotal + tax;

    // Calculate expiration
    const expiresAt = new Date(
      Date.now() + config.agentSessionExpirationMinutes * 60 * 1000
    );

    // Create session
    const session = await prisma.agentSession.create({
      data: {
        storeId: req.storeId!,
        agentId: req.agent!.agentId,
        ownerId: req.agent!.ownerId,
        status: 'cart_building',
        cart: {
          items: cartItems,
          subtotal,
          tax,
          shipping: null,
          total,
          currency: 'CAD',
        },
        expiresAt,
        messages: [
          {
            timestamp: new Date().toISOString(),
            type: 'session_created',
            message: `Session created with ${cartItems.length} item(s)`,
          },
        ],
      },
    });

    console.log(
      `[Agent API] Session created: ${session.id} by agent ${req.agent!.agentId}`
    );

    res.status(201).json(formatSession(session));
  } catch (error) {
    console.error('[Agent API] Create session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * GET /api/agent/v1/sessions/:id
 * Get session details
 */
router.get('/sessions/:id', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const session = await prisma.agentSession.findFirst({
      where: {
        id: req.params.id,
        storeId: req.storeId,
        agentId: req.agent!.agentId,
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check if expired
    if (new Date() > session.expiresAt && session.status !== 'completed') {
      await prisma.agentSession.update({
        where: { id: session.id },
        data: { status: 'cancelled' },
      });
      session.status = 'cancelled';
    }

    res.json(formatSession(session));
  } catch (error) {
    console.error('[Agent API] Get session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

/**
 * PATCH /api/agent/v1/sessions/:id
 * Update session (items, buyer info, fulfillment)
 */
router.patch('/sessions/:id', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const session = await prisma.agentSession.findFirst({
      where: {
        id: req.params.id,
        storeId: req.storeId,
        agentId: req.agent!.agentId,
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check if session can be updated
    if (!['cart_building', 'awaiting_buyer_info'].includes(session.status)) {
      return res.status(400).json({
        error: 'session_not_editable',
        message: `Session in ${session.status} status cannot be modified`,
      });
    }

    // Check expiration
    if (new Date() > session.expiresAt) {
      return res.status(400).json({
        error: 'session_expired',
        message: 'Session has expired',
      });
    }

    const { items, buyer, fulfillment } = req.body;
    const updates: any = {};
    const messages: any[] = [...(session.messages as any[])];

    // Update items if provided
    if (items && Array.isArray(items)) {
      const productIds = items.map((item: any) => item.productId);
      const products = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          storeId: req.storeId,
          isActive: true,
        },
      });

      if (products.length !== productIds.length) {
        const foundIds = products.map((p) => p.id);
        const missingIds = productIds.filter((id: string) => !foundIds.includes(id));
        return res.status(400).json({
          error: 'item_unavailable',
          message: 'Some products are not available',
          unavailableItems: missingIds,
        });
      }

      const cartItems = items.map((item: any) => {
        const product = products.find((p) => p.id === item.productId)!;
        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        return {
          productId: product.id,
          name: product.name,
          quantity,
          unitPrice: product.price,
          subtotal: product.price * quantity,
        };
      });

      const subtotal = cartItems.reduce((sum: number, item: any) => sum + item.subtotal, 0);
      const tax = Math.round(subtotal * 0.13);
      const cart = session.cart as any;
      const total = subtotal + tax + (cart.shipping || 0);

      updates.cart = {
        ...cart,
        items: cartItems,
        subtotal,
        tax,
        total,
      };

      messages.push({
        timestamp: new Date().toISOString(),
        type: 'cart_updated',
        message: `Cart updated with ${cartItems.length} item(s)`,
      });
    }

    // Update buyer info if provided
    if (buyer) {
      updates.buyer = buyer;
      messages.push({
        timestamp: new Date().toISOString(),
        type: 'buyer_info_updated',
        message: 'Buyer information updated',
      });
    }

    // Update fulfillment if provided
    if (fulfillment) {
      updates.fulfillment = fulfillment;

      // Calculate shipping (flat rate for MVP per Q2)
      const cart = (updates.cart || session.cart) as any;
      const shippingCost = 1000; // $10.00 flat rate
      updates.cart = {
        ...cart,
        shipping: shippingCost,
        total: cart.subtotal + cart.tax + shippingCost,
      };

      messages.push({
        timestamp: new Date().toISOString(),
        type: 'fulfillment_updated',
        message: 'Shipping information updated',
      });
    }

    // Determine new status
    const updatedBuyer = updates.buyer || session.buyer;
    const updatedFulfillment = updates.fulfillment || session.fulfillment;

    if (updatedBuyer && updatedFulfillment) {
      updates.status = 'ready_for_payment';
      messages.push({
        timestamp: new Date().toISOString(),
        type: 'status_changed',
        message: 'Session ready for payment',
      });
    } else if (!updatedBuyer || !updatedFulfillment) {
      updates.status = 'awaiting_buyer_info';
    }

    updates.messages = messages;

    const updated = await prisma.agentSession.update({
      where: { id: session.id },
      data: updates,
    });

    res.json(formatSession(updated));
  } catch (error) {
    console.error('[Agent API] Update session error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

/**
 * POST /api/agent/v1/sessions/:id/complete
 * Complete checkout with payment
 */
router.post(
  '/sessions/:id/complete',
  authenticateAgent,
  async (req: Request, res: Response) => {
    try {
      const session = await prisma.agentSession.findFirst({
        where: {
          id: req.params.id,
          storeId: req.storeId,
          agentId: req.agent!.agentId,
        },
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (session.status !== 'ready_for_payment') {
        return res.status(400).json({
          error: 'session_not_ready',
          message: `Session must be in ready_for_payment status (current: ${session.status})`,
        });
      }

      if (new Date() > session.expiresAt) {
        return res.status(400).json({
          error: 'session_expired',
          message: 'Session has expired',
        });
      }

      const { paymentToken, mandateId } = req.body;
      const cart = session.cart as any;

      // If no payment token, request one from WSIM
      if (!paymentToken) {
        const authHeader = req.headers.authorization!;
        const agentToken = authHeader.substring(7);

        const tokenResponse = await requestPaymentToken(agentToken, {
          merchantId: config.merchantId,
          amount: cart.total,
          currency: cart.currency,
          sessionId: session.id,
          items: cart.items.map((item: any) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.unitPrice,
          })),
          callbackUrl: `${config.appBaseUrl}/api/agent/v1/sessions/${session.id}/webhook`,
        });

        if (tokenResponse.stepUpRequired) {
          // Update session to awaiting authorization
          const messages = [...(session.messages as any[])];
          messages.push({
            timestamp: new Date().toISOString(),
            type: 'step_up_required',
            message: `Human approval required for $${(cart.total / 100).toFixed(2)} purchase`,
          });

          await prisma.agentSession.update({
            where: { id: session.id },
            data: {
              status: 'awaiting_authorization',
              mandateId: tokenResponse.stepUpId,
              messages,
            },
          });

          return res.status(202).json({
            status: 'awaiting_authorization',
            stepUpId: tokenResponse.stepUpId,
            message: 'Human approval required. Check back for status.',
          });
        }

        if (!tokenResponse.success) {
          return res.status(400).json({
            error: 'payment_token_failed',
            message: tokenResponse.error || 'Failed to get payment token',
          });
        }

        // Continue with the payment token
        req.body.paymentToken = tokenResponse.paymentToken;
      }

      // Update session to processing
      const messages = [...(session.messages as any[])];
      messages.push({
        timestamp: new Date().toISOString(),
        type: 'processing',
        message: 'Processing payment',
      });

      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          status: 'processing',
          mandateId: mandateId || session.mandateId,
          messages,
        },
      });

      // TODO: Integrate with NSIM payment processing
      // For now, simulate successful payment in mock mode
      if (process.env.WSIM_AGENT_MOCK === 'true') {
        // Create order
        const buyer = session.buyer as any;
        const order = await prisma.order.create({
          data: {
            storeId: session.storeId,
            bsimUserId: session.ownerId, // Agent's owner
            items: cart.items,
            subtotal: cart.total,
            currency: cart.currency,
            status: 'authorized',
            agentId: session.agentId,
            agentSessionId: session.id,
            paymentDetails: {
              paymentMethod: 'agent_wallet',
              agentId: session.agentId,
              mandateId: mandateId || null,
            },
          },
        });

        // Update session to completed
        messages.push({
          timestamp: new Date().toISOString(),
          type: 'completed',
          message: `Order ${order.id} created successfully`,
        });

        await prisma.agentSession.update({
          where: { id: session.id },
          data: {
            status: 'completed',
            payment: {
              orderId: order.id,
              transactionId: `mock_tx_${Date.now()}`,
              status: 'authorized',
            },
            messages,
          },
        });

        return res.json({
          status: 'completed',
          orderId: order.id,
          message: 'Order created successfully',
        });
      }

      // Real NSIM integration would go here
      res.status(501).json({
        error: 'not_implemented',
        message: 'Real payment processing not yet implemented. Enable WSIM_AGENT_MOCK=true for testing.',
      });
    } catch (error) {
      console.error('[Agent API] Complete session error:', error);
      res.status(500).json({ error: 'Failed to complete checkout' });
    }
  }
);

/**
 * DELETE /api/agent/v1/sessions/:id
 * Cancel a session
 */
router.delete('/sessions/:id', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const session = await prisma.agentSession.findFirst({
      where: {
        id: req.params.id,
        storeId: req.storeId,
        agentId: req.agent!.agentId,
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (['completed', 'cancelled', 'failed'].includes(session.status)) {
      return res.status(400).json({
        error: 'session_not_cancellable',
        message: `Session in ${session.status} status cannot be cancelled`,
      });
    }

    const messages = [...(session.messages as any[])];
    messages.push({
      timestamp: new Date().toISOString(),
      type: 'cancelled',
      message: 'Session cancelled by agent',
    });

    await prisma.agentSession.update({
      where: { id: session.id },
      data: {
        status: 'cancelled',
        messages,
      },
    });

    res.json({ status: 'cancelled', message: 'Session cancelled successfully' });
  } catch (error) {
    console.error('[Agent API] Cancel session error:', error);
    res.status(500).json({ error: 'Failed to cancel session' });
  }
});

/**
 * Format session for API response
 */
function formatSession(session: any) {
  const cart = session.cart as any;
  return {
    sessionId: session.id,
    status: session.status,
    cart: cart
      ? {
          items: cart.items?.map((item: any) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice / 100,
            subtotal: item.subtotal / 100,
          })),
          subtotal: (cart.subtotal || 0) / 100,
          tax: (cart.tax || 0) / 100,
          shipping: cart.shipping ? cart.shipping / 100 : null,
          total: (cart.total || 0) / 100,
          currency: cart.currency || 'CAD',
        }
      : null,
    buyer: session.buyer,
    fulfillment: session.fulfillment,
    payment: session.payment,
    messages: session.messages,
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

export default router;
