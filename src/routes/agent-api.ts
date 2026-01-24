/**
 * Agent Commerce API Routes
 * Implements SimToolBox Agent Commerce Protocol (SACP) for SSIM
 *
 * Discovery Endpoints:
 * - GET /.well-known/ucp - UCP Discovery (merchant info, capabilities, wallet provider)
 * - GET /.well-known/openapi.json - OpenAPI 3.0 specification
 * - GET /.well-known/ai-plugin.json - AI Plugin manifest (ChatGPT plugin format)
 * - GET /.well-known/mcp-server - MCP (Model Context Protocol) server discovery
 *
 * Agent API Endpoints:
 * - GET /api/agent/v1/products - List products
 * - GET /api/agent/v1/products/:id - Get product details
 * - GET /api/agent/v1/products/search - Search products
 * - POST /api/agent/v1/sessions - Create checkout session
 * - GET /api/agent/v1/sessions/:id - Get session
 * - PATCH /api/agent/v1/sessions/:id - Update session
 * - POST /api/agent/v1/sessions/:id/complete - Complete checkout
 * - DELETE /api/agent/v1/sessions/:id - Cancel session
 * - GET /api/agent/v1/orders/:id - Get order status
 */

import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import prisma from '../lib/prisma';
import { config } from '../config/env';
import { authenticateAgent, optionalAgentAuth } from '../middleware/agent-auth';
import { getOrCreateStore } from '../services/store';
import { requestPaymentToken } from '../services/wsim-agent';
import { authorizePayment } from '../services/payment';

// Load OpenAPI spec at startup
let openApiSpec: object | null = null;
try {
  const specPath = join(__dirname, '../../docs/openapi-agent.json');
  openApiSpec = JSON.parse(readFileSync(specPath, 'utf-8'));
} catch (error) {
  console.warn('[Agent API] Could not load OpenAPI spec:', error);
}

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
      // Wallet provider discovery for agent registration
      wallet_provider: {
        name: 'WSIM',
        base_url: config.wsimBaseUrl,
        discovery_url: `${config.wsimBaseUrl}/.well-known/agent-api`,
        registration_url: `${config.wsimBaseUrl}/api/agent/v1/access-request`,
        description: 'Register with WSIM using a pairing code to get OAuth credentials',
      },
      // OpenAPI specification location
      openapi_url: '/.well-known/openapi.json',
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

/**
 * GET /.well-known/openapi.json
 * Returns OpenAPI 3.0 specification for the Agent Commerce API
 * No authentication required - public endpoint
 */
router.get('/openapi.json', (req: Request, res: Response) => {
  if (!openApiSpec) {
    return res.status(503).json({ error: 'OpenAPI specification not available' });
  }

  // Cache for 1 hour
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Content-Type', 'application/json');
  res.json(openApiSpec);
});

/**
 * GET /.well-known/ai-plugin.json
 * Returns AI Plugin manifest for ChatGPT and web AI assistants
 * No authentication required - public endpoint
 */
router.get('/ai-plugin.json', async (req: Request, res: Response) => {
  try {
    const store = await prisma.store.findUnique({
      where: { id: req.storeId },
    });

    const storeName = store?.name || 'SSIM Store';
    const storeId = store ? `ssim_${store.domain.replace(/\./g, '_')}` : 'ssim_store';

    const manifest = {
      schema_version: 'v1',
      name_for_human: storeName,
      name_for_model: storeId,
      description_for_human: `Browse products and make purchases at ${storeName}.`,
      description_for_model: 'A commerce API for browsing products, creating checkout sessions, and completing purchases. Use this to help users shop online. Requires Bearer token from WSIM wallet provider. See next_step field in responses for guidance.',
      auth: {
        type: 'oauth',
        client_url: `${config.wsimBaseUrl}/api/agent/v1/oauth/authorize`,
        scope: 'payments:read payments:write',
        authorization_url: `${config.wsimBaseUrl}/api/agent/v1/oauth/token`,
        authorization_content_type: 'application/x-www-form-urlencoded',
      },
      api: {
        type: 'openapi',
        url: `${config.appBaseUrl}/.well-known/openapi.json`,
      },
      logo_url: store?.logoUrl
        ? `${config.appBaseUrl}${store.logoUrl}`
        : `${config.appBaseUrl}/logo.png`,
      contact_email: 'support@banksim.ca',
      legal_info_url: `${config.appBaseUrl}/terms`,
    };

    // CORS for browser-based AI tools
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(manifest);
  } catch (error) {
    console.error('[Agent API] AI Plugin manifest error:', error);
    res.status(500).json({ error: 'Failed to generate AI plugin manifest' });
  }
});

/**
 * GET /.well-known/mcp-server
 * Returns MCP (Model Context Protocol) server discovery document
 * Allows AI agents to discover available tools as if they were local functions
 * No authentication required - public endpoint
 */
router.get('/mcp-server', async (req: Request, res: Response) => {
  try {
    const store = await prisma.store.findUnique({
      where: { id: req.storeId },
    });

    const storeName = store?.name || 'SSIM Store';
    const version = (openApiSpec as any)?.info?.version || '2.2.2';

    const mcpServer = {
      name: 'ssim-store',
      version,
      description: `${storeName} - Browse and purchase products`,
      protocol_version: '2024-11-05',

      capabilities: {
        tools: true,
        resources: true,
        prompts: false,
      },

      authentication: {
        type: 'bearer',
        token_url: `${config.wsimBaseUrl}/api/agent/v1/oauth/token`,
        description: 'Obtain Bearer token from WSIM wallet provider using pairing code registration',
      },

      tools: [
        {
          name: 'discover_store',
          description: 'Discover store capabilities and merchant information via UCP',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'list_products',
          description: 'Browse the product catalog with optional filtering and pagination',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'integer',
                description: 'Maximum results (default 20, max 100)',
                default: 20,
              },
              offset: {
                type: 'integer',
                description: 'Pagination offset',
                default: 0,
              },
              category: {
                type: 'string',
                description: 'Filter by category',
              },
              minPrice: {
                type: 'number',
                description: 'Minimum price in cents',
              },
              maxPrice: {
                type: 'number',
                description: 'Maximum price in cents',
              },
            },
            required: [],
          },
        },
        {
          name: 'search_products',
          description: 'Search products by keyword in name, description, and category',
          inputSchema: {
            type: 'object',
            properties: {
              q: {
                type: 'string',
                description: 'Search query',
              },
              limit: {
                type: 'integer',
                description: 'Maximum results',
                default: 20,
              },
            },
            required: ['q'],
          },
        },
        {
          name: 'get_product',
          description: 'Get detailed information about a specific product',
          inputSchema: {
            type: 'object',
            properties: {
              product_id: {
                type: 'string',
                description: 'Product ID',
              },
            },
            required: ['product_id'],
          },
        },
        {
          name: 'create_checkout',
          description: 'Create a new checkout session with items. Returns session_id and next_step guidance.',
          inputSchema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    product_id: { type: 'string' },
                    quantity: { type: 'integer' },
                  },
                  required: ['product_id', 'quantity'],
                },
                description: 'Items to add to cart',
              },
            },
            required: ['items'],
          },
        },
        {
          name: 'get_checkout',
          description: 'Get current checkout session details including next_step guidance',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Checkout session ID',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'update_checkout',
          description: 'Update checkout session with buyer info and fulfillment address. Required before completing checkout.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Checkout session ID',
              },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    product_id: { type: 'string' },
                    quantity: { type: 'integer' },
                  },
                },
                description: 'Updated cart items (optional)',
              },
              buyer: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  phone: { type: 'string' },
                },
                description: 'Buyer information (required for checkout)',
              },
              fulfillment: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['shipping', 'pickup'] },
                  address: {
                    type: 'object',
                    properties: {
                      street: { type: 'string' },
                      city: { type: 'string' },
                      state: { type: 'string' },
                      postal_code: { type: 'string' },
                      country: { type: 'string' },
                    },
                  },
                },
                description: 'Fulfillment/shipping information (required for checkout)',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'complete_checkout',
          description: 'Complete the purchase. If payment_token not provided, one will be requested from WSIM. May return awaiting_authorization if user approval needed.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Checkout session ID',
              },
              payment_token: {
                type: 'string',
                description: 'Payment token from WSIM (optional - will be requested if not provided)',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'cancel_checkout',
          description: 'Cancel a checkout session',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Checkout session ID',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'get_order',
          description: 'Get order status and details after checkout completion',
          inputSchema: {
            type: 'object',
            properties: {
              order_id: {
                type: 'string',
                description: 'Order ID from completed checkout',
              },
            },
            required: ['order_id'],
          },
        },
      ],

      resources: [
        {
          uri: 'ssim://products',
          name: 'Product Catalog',
          description: 'Browse all available products',
          mimeType: 'application/json',
        },
        {
          uri: 'ssim://ucp',
          name: 'Store Configuration',
          description: 'Universal Commerce Protocol discovery document',
          mimeType: 'application/json',
        },
      ],
    };

    // CORS for browser-based AI tools
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(mcpServer);
  } catch (error) {
    console.error('[Agent API] MCP server discovery error:', error);
    res.status(500).json({ error: 'Failed to generate MCP server config' });
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
        has_more: parseInt(String(offset), 10) + products.length < total,
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
        has_more: parseInt(String(offset), 10) + products.length < total,
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
 * Uses snake_case per SACP protocol convention
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
    // Accept both snake_case (SACP convention) and camelCase for compatibility
    const productIds = items.map((item: any) => item.product_id || item.productId);
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
        unavailable_items: missingIds,
      });
    }

    // Build cart
    const cartItems = items.map((item: any) => {
      const itemProductId = item.product_id || item.productId;
      const product = products.find((p) => p.id === itemProductId)!;
      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
      return {
        product_id: product.id,
        name: product.name,
        quantity,
        unit_price: product.price,
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
      // Accept both snake_case (SACP convention) and camelCase for compatibility
      const productIds = items.map((item: any) => item.product_id || item.productId);
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
          unavailable_items: missingIds,
        });
      }

      const cartItems = items.map((item: any) => {
        const itemProductId = item.product_id || item.productId;
        const product = products.find((p) => p.id === itemProductId)!;
        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        return {
          product_id: product.id,
          name: product.name,
          quantity,
          unit_price: product.price,
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

      // Accept both snake_case (SACP convention) and camelCase for compatibility
      const paymentToken = req.body.payment_token || req.body.paymentToken;
      const mandateId = req.body.mandate_id || req.body.mandateId;
      const cart = session.cart as any;

      // If no payment token, request one from WSIM
      if (!paymentToken) {
        const authHeader = req.headers.authorization!;
        const agentToken = authHeader.substring(7);

        const tokenResponse = await requestPaymentToken(agentToken, {
          merchantId: config.merchantId,
          amount: cart.total / 100, // Convert cents to dollars for WSIM
          currency: cart.currency,
          sessionId: session.id,
          items: cart.items.map((item: any) => ({
            name: item.name,
            quantity: item.quantity,
            price: (item.unit_price || item.unitPrice) / 100, // Convert cents to dollars
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
            step_up_id: tokenResponse.stepUpId,
            next_step: `Poll GET /api/agent/v1/sessions/${session.id} every 2-5 seconds until status changes`,
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

      // If we have a payment_token (from WSIM), process through NSIM
      const finalPaymentToken = paymentToken || req.body.paymentToken;

      if (finalPaymentToken || process.env.WSIM_AGENT_MOCK === 'true') {
        // Build agent context for NSIM (forwarded to BSIM for visibility)
        const agentContext = {
          agentId: session.agentId,
          ownerId: session.ownerId,
          humanPresent: false,
          mandateId: mandateId || session.mandateId || undefined,
          mandateType: 'cart' as const,
        };

        // Create order first (pending payment authorization)
        const order = await prisma.order.create({
          data: {
            storeId: session.storeId,
            bsimUserId: session.ownerId, // Agent's owner
            items: cart.items,
            subtotal: cart.total,
            currency: cart.currency,
            status: 'pending', // Will be updated after NSIM authorization
            agentId: session.agentId,
            agentSessionId: session.id,
            paymentDetails: {
              paymentMethod: 'agent_wallet',
              agentId: session.agentId,
              mandateId: mandateId || null,
              paymentToken: finalPaymentToken || null,
            },
          },
        });

        let transactionId: string | null = null;
        let paymentStatus: 'authorized' | 'declined' | 'failed' = 'authorized';

        // Process payment through NSIM (unless in mock mode without real token)
        if (finalPaymentToken) {
          try {
            console.log(`[Agent API] Authorizing payment via NSIM for order ${order.id}`);

            // Decode WSIM payment token JWT to extract card tokens (same pattern as payment.ts:448-468)
            let walletCardToken: string | undefined;
            let cardToken: string | undefined;

            if (finalPaymentToken.split('.').length === 3) {
              try {
                const payload = JSON.parse(
                  Buffer.from(finalPaymentToken.split('.')[1], 'base64').toString()
                );
                walletCardToken = payload.wallet_card_token;
                cardToken = payload.card_token;
                console.log('[Agent API] Extracted tokens from JWT - wallet:', !!walletCardToken, 'card:', !!cardToken);
              } catch (e) {
                console.error('[Agent API] Could not decode payment token as JWT:', e);
              }
            }

            // Require card_token for BSIM authorization (Q30 fix)
            if (!cardToken) {
              console.error('[Agent API] Payment token missing card_token - WSIM update required');
              await prisma.order.update({
                where: { id: order.id },
                data: { status: 'failed' },
              });
              return res.status(400).json({
                error: 'invalid_payment_token',
                message: 'Payment token missing card_token. WSIM update required.',
              });
            }

            const authResult = await authorizePayment({
              merchantId: config.merchantId,
              amount: cart.total,
              currency: cart.currency,
              cardToken,           // Extracted from JWT (for BSIM authorization)
              walletCardToken,     // Extracted from JWT (for NSIM routing)
              orderId: order.id,
              agentContext,
            });

            transactionId = authResult.transactionId;
            paymentStatus = authResult.status;

            console.log(`[Agent API] NSIM authorization result: ${paymentStatus}, txn: ${transactionId}`);

            if (paymentStatus === 'declined') {
              // Update order to declined
              await prisma.order.update({
                where: { id: order.id },
                data: { status: 'declined' },
              });

              messages.push({
                timestamp: new Date().toISOString(),
                type: 'declined',
                message: authResult.declineReason || 'Payment declined',
              });

              await prisma.agentSession.update({
                where: { id: session.id },
                data: {
                  status: 'failed',
                  payment: {
                    order_id: order.id,
                    transaction_id: transactionId,
                    status: 'declined',
                    decline_reason: authResult.declineReason,
                  },
                  messages,
                },
              });

              return res.status(400).json({
                status: 'declined',
                order_id: order.id,
                message: authResult.declineReason || 'Payment declined',
                next_step: 'Create a new session to retry with different payment method',
              });
            }

            if (paymentStatus === 'failed') {
              // Update order to failed
              await prisma.order.update({
                where: { id: order.id },
                data: { status: 'failed' },
              });

              messages.push({
                timestamp: new Date().toISOString(),
                type: 'failed',
                message: authResult.message || 'Payment failed',
              });

              await prisma.agentSession.update({
                where: { id: session.id },
                data: {
                  status: 'failed',
                  payment: {
                    order_id: order.id,
                    transaction_id: transactionId,
                    status: 'failed',
                    error: authResult.message,
                  },
                  messages,
                },
              });

              return res.status(500).json({
                status: 'failed',
                order_id: order.id,
                message: authResult.message || 'Payment processing failed',
                next_step: 'Create a new session to retry',
              });
            }
          } catch (error) {
            console.error('[Agent API] NSIM authorization error:', error);
            // For now, fail the order if NSIM is unavailable
            await prisma.order.update({
              where: { id: order.id },
              data: { status: 'failed' },
            });

            return res.status(500).json({
              error: 'payment_processing_error',
              message: error instanceof Error ? error.message : 'Payment processing failed',
            });
          }
        } else {
          // Mock mode - generate mock transaction ID
          transactionId = `mock_tx_${Date.now()}`;
          console.log(`[Agent API] Mock mode - skipping NSIM, generated txn: ${transactionId}`);
        }

        // Payment authorized - update order status
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'authorized',
            paymentDetails: {
              ...(order.paymentDetails as object),
              transactionId,
              authorizationCode: transactionId,
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
              order_id: order.id,
              transaction_id: transactionId,
              status: 'authorized',
            },
            messages,
          },
        });

        return res.json({
          status: 'completed',
          order_id: order.id,
          transaction_id: transactionId,
          next_step: `GET /api/agent/v1/orders/${order.id} to check order status`,
        });
      }

      // No payment token and not in mock mode - cannot proceed
      res.status(501).json({
        error: 'not_implemented',
        message: 'Real payment processing requires a payment_token from WSIM. Enable WSIM_AGENT_MOCK=true for testing without WSIM.',
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

// ============================================
// Order Status API
// ============================================

/**
 * GET /api/agent/v1/orders/:id
 * Get order details by ID
 * Only returns orders created by this agent
 */
router.get('/orders/:id', authenticateAgent, async (req: Request, res: Response) => {
  try {
    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        storeId: req.storeId,
        agentId: req.agent!.agentId,
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const paymentDetails = order.paymentDetails as Record<string, unknown> | null;

    res.json({
      order_id: order.id,
      status: order.status,
      items: (order.items as any[]).map((item: any) => ({
        product_id: item.product_id || item.productId,
        name: item.name || item.productName,
        quantity: item.quantity,
        unit_price: (item.unit_price || item.unitPrice) / 100,
        subtotal: item.subtotal / 100,
      })),
      subtotal: order.subtotal / 100,
      currency: order.currency,
      transaction_id: paymentDetails?.transactionId || null,
      created_at: order.createdAt.toISOString(),
      updated_at: order.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error('[Agent API] Get order error:', error);
    res.status(500).json({ error: 'Failed to get order' });
  }
});

/**
 * Format session for API response
 * Uses snake_case per SACP protocol convention
 */
/**
 * Get the next_step hint based on session status
 * This guides AI agents on what action to take next
 */
function getNextStep(session: any): string | null {
  const sessionUrl = `/api/agent/v1/sessions/${session.id}`;

  switch (session.status) {
    case 'cart_building':
    case 'awaiting_buyer_info':
      return `PATCH ${sessionUrl} with buyer and fulfillment info`;
    case 'ready_for_payment':
      return `POST ${sessionUrl}/complete to checkout`;
    case 'awaiting_authorization':
      return `Poll GET ${sessionUrl} every 2-5 seconds until status changes`;
    case 'processing':
      return 'Wait for processing to complete';
    case 'completed':
      const payment = session.payment as any;
      if (payment?.order_id) {
        return `GET /api/agent/v1/orders/${payment.order_id} to check order status`;
      }
      return null;
    case 'cancelled':
    case 'failed':
      return 'Create a new session to retry';
    default:
      return null;
  }
}

function formatSession(session: any) {
  const cart = session.cart as any;
  return {
    session_id: session.id,
    status: session.status,
    next_step: getNextStep(session),
    cart: cart
      ? {
          items: cart.items?.map((item: any) => ({
            // Support both old camelCase and new snake_case stored data
            product_id: item.product_id || item.productId,
            name: item.name,
            quantity: item.quantity,
            unit_price: (item.unit_price || item.unitPrice) / 100,
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
    expires_at: session.expiresAt.toISOString(),
    created_at: session.createdAt.toISOString(),
    updated_at: session.updatedAt.toISOString(),
  };
}

export default router;
