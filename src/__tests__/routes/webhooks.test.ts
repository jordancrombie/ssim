// Mock the order service - must be before imports
const mockOrderService = {
  getOrderByTransactionId: jest.fn(),
  setOrderAuthorized: jest.fn(),
  setOrderCaptured: jest.fn(),
  setOrderVoided: jest.fn(),
  setOrderRefunded: jest.fn(),
  setOrderDeclined: jest.fn(),
  setOrderFailed: jest.fn(),
};

jest.mock('../../services/order', () => mockOrderService);

// Mock the store service
jest.mock('../../services/store', () => ({
  getOrCreateStore: jest.fn().mockResolvedValue({ id: 'store-123', name: 'Test Store' }),
}));

// Mock the config
jest.mock('../../config/env', () => ({
  config: {
    webhookSecret: 'test-webhook-secret',
    merchantId: 'merchant-123',
  },
}));

import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import webhooksRouter from '../../routes/webhooks';

// Helper to generate valid signature
function generateSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hmac}`;
}

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/webhooks', webhooksRouter);
  return app;
};

describe('Webhooks Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /webhooks/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/webhooks/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', endpoint: 'webhooks' });
    });
  });

  describe('POST /webhooks/payment', () => {
    const basePayload = {
      id: 'webhook-event-1',
      type: 'payment.authorized',
      timestamp: '2025-12-11T10:00:00Z',
      data: {
        transactionId: 'tx-123',
        merchantId: 'merchant-123',
        amount: 5000,
        currency: 'CAD',
        status: 'authorized',
        orderId: 'order-456',
        authorizationCode: 'AUTH789',
      },
    };

    describe('Signature verification', () => {
      it('should reject requests without signature', async () => {
        const response = await request(app)
          .post('/webhooks/payment')
          .send(basePayload);

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid webhook signature');
      });

      it('should reject requests with invalid signature format', async () => {
        const response = await request(app)
          .post('/webhooks/payment')
          .set('X-Webhook-Signature', 'invalid-signature')
          .send(basePayload);

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid webhook signature');
      });

      it('should reject requests with wrong signature', async () => {
        const wrongSignature = generateSignature(JSON.stringify(basePayload), 'wrong-secret');
        const response = await request(app)
          .post('/webhooks/payment')
          .set('X-Webhook-Signature', wrongSignature)
          .send(basePayload);

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid webhook signature');
      });

      it('should accept requests with valid signature', async () => {
        const payload = JSON.stringify(basePayload);
        const signature = generateSignature(payload, 'test-webhook-secret');

        const response = await request(app)
          .post('/webhooks/payment')
          .set('X-Webhook-Signature', signature)
          .set('Content-Type', 'application/json')
          .send(payload);

        expect(response.status).toBe(200);
        expect(response.body.received).toBe(true);
      });
    });

    describe('Merchant ID validation', () => {
      it('should ignore events for different merchant', async () => {
        const wrongMerchantPayload = {
          ...basePayload,
          data: { ...basePayload.data, merchantId: 'different-merchant' },
        };
        const payload = JSON.stringify(wrongMerchantPayload);
        const signature = generateSignature(payload, 'test-webhook-secret');

        const response = await request(app)
          .post('/webhooks/payment')
          .set('X-Webhook-Signature', signature)
          .set('Content-Type', 'application/json')
          .send(payload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ received: true, ignored: true });
      });
    });

    describe('Event handling', () => {
      const sendWebhook = async (eventPayload: any) => {
        const payload = JSON.stringify(eventPayload);
        const signature = generateSignature(payload, 'test-webhook-secret');
        return request(app)
          .post('/webhooks/payment')
          .set('X-Webhook-Signature', signature)
          .set('Content-Type', 'application/json')
          .send(payload);
      };

      describe('payment.authorized', () => {
        it('should update pending order to authorized', async () => {
          const mockOrder = { id: 'order-456', status: 'pending' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = { ...basePayload, type: 'payment.authorized' };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(mockOrderService.setOrderAuthorized).toHaveBeenCalledWith(
            'store-123',
            'order-456',
            'tx-123',
            'AUTH789',
            ''
          );
        });

        it('should not update order if already authorized', async () => {
          const mockOrder = { id: 'order-456', status: 'authorized' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = { ...basePayload, type: 'payment.authorized' };
          await sendWebhook(payload);

          expect(mockOrderService.setOrderAuthorized).not.toHaveBeenCalled();
        });
      });

      describe('payment.captured', () => {
        it('should update authorized order to captured', async () => {
          const mockOrder = { id: 'order-456', status: 'authorized' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = {
            ...basePayload,
            type: 'payment.captured',
            data: { ...basePayload.data, capturedAmount: 5000 },
          };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(mockOrderService.setOrderCaptured).toHaveBeenCalledWith(
            'store-123',
            'order-456',
            5000
          );
        });

        it('should not update order if not authorized', async () => {
          const mockOrder = { id: 'order-456', status: 'pending' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = { ...basePayload, type: 'payment.captured' };
          await sendWebhook(payload);

          expect(mockOrderService.setOrderCaptured).not.toHaveBeenCalled();
        });
      });

      describe('payment.voided', () => {
        it('should void authorized order', async () => {
          const mockOrder = { id: 'order-456', status: 'authorized' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = { ...basePayload, type: 'payment.voided' };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(mockOrderService.setOrderVoided).toHaveBeenCalledWith(
            'store-123',
            'order-456'
          );
        });
      });

      describe('payment.refunded', () => {
        it('should refund captured order', async () => {
          const mockOrder = { id: 'order-456', status: 'captured' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = {
            ...basePayload,
            type: 'payment.refunded',
            data: { ...basePayload.data, refundedAmount: 2500 },
          };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(mockOrderService.setOrderRefunded).toHaveBeenCalledWith(
            'store-123',
            'order-456',
            2500
          );
        });
      });

      describe('payment.declined', () => {
        it('should decline pending order', async () => {
          const mockOrder = { id: 'order-456', status: 'pending' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = {
            ...basePayload,
            type: 'payment.declined',
            data: { ...basePayload.data, declineReason: 'Insufficient funds' },
          };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(mockOrderService.setOrderDeclined).toHaveBeenCalledWith(
            'store-123',
            'order-456'
          );
        });
      });

      describe('payment.expired', () => {
        it('should void expired authorization', async () => {
          const mockOrder = { id: 'order-456', status: 'authorized' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = { ...basePayload, type: 'payment.expired' };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(mockOrderService.setOrderVoided).toHaveBeenCalledWith(
            'store-123',
            'order-456'
          );
        });
      });

      describe('payment.failed', () => {
        it('should mark pending order as failed', async () => {
          const mockOrder = { id: 'order-456', status: 'pending' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = {
            ...basePayload,
            type: 'payment.failed',
            data: { ...basePayload.data, failureReason: 'Network error' },
          };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(mockOrderService.setOrderFailed).toHaveBeenCalledWith(
            'store-123',
            'order-456'
          );
        });

        it('should mark authorized order as failed', async () => {
          const mockOrder = { id: 'order-456', status: 'authorized' };
          mockOrderService.getOrderByTransactionId.mockResolvedValue(mockOrder);

          const payload = { ...basePayload, type: 'payment.failed' };
          await sendWebhook(payload);

          expect(mockOrderService.setOrderFailed).toHaveBeenCalled();
        });
      });

      describe('Unknown event types', () => {
        it('should acknowledge unknown event types', async () => {
          const payload = { ...basePayload, type: 'payment.unknown' };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(response.body.received).toBe(true);
        });
      });

      describe('Error handling', () => {
        it('should return 200 even when processing fails', async () => {
          mockOrderService.getOrderByTransactionId.mockRejectedValue(new Error('DB error'));

          const payload = { ...basePayload, type: 'payment.authorized' };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(response.body).toEqual({ received: true, error: 'Processing error' });
        });
      });

      describe('Order not found', () => {
        it('should handle missing order gracefully', async () => {
          mockOrderService.getOrderByTransactionId.mockResolvedValue(null);

          const payload = { ...basePayload, type: 'payment.captured' };
          const response = await sendWebhook(payload);

          expect(response.status).toBe(200);
          expect(mockOrderService.setOrderCaptured).not.toHaveBeenCalled();
        });
      });
    });
  });
});
