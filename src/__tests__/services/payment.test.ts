// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock the config module
jest.mock('../../config/env', () => ({
  config: {
    paymentApiUrl: 'https://payment.test.com',
    paymentApiKey: 'test-api-key',
  },
}));

import * as paymentService from '../../services/payment';

describe('Payment Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('authorizePayment', () => {
    it('should authorize payment successfully', async () => {
      const mockResponse = {
        transactionId: 'tx-123',
        status: 'authorized',
        authorizationCode: 'AUTH456',
        timestamp: '2025-12-11T10:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await paymentService.authorizePayment({
        merchantId: 'merchant-1',
        amount: 5000, // 50.00 in cents
        currency: 'CAD',
        cardToken: 'card-token-123',
        orderId: 'order-456',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://payment.test.com/api/v1/payments/authorize',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-API-Key': 'test-api-key',
          },
          body: JSON.stringify({
            merchantId: 'merchant-1',
            amount: 50, // Converted to dollars
            currency: 'CAD',
            cardToken: 'card-token-123',
            orderId: 'order-456',
          }),
        })
      );
    });

    it('should include walletCardToken for wallet payments', async () => {
      const mockResponse = {
        transactionId: 'tx-123',
        status: 'authorized',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await paymentService.authorizePayment({
        merchantId: 'merchant-1',
        amount: 5000,
        currency: 'CAD',
        cardToken: 'card-token-123',
        walletCardToken: 'wallet-token-789',
        orderId: 'order-456',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.walletCardToken).toBe('wallet-token-789');
    });

    it('should return declined status from API', async () => {
      const mockResponse = {
        transactionId: 'tx-123',
        status: 'declined',
        declineReason: 'Insufficient funds',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => mockResponse,
      });

      const result = await paymentService.authorizePayment({
        merchantId: 'merchant-1',
        amount: 5000,
        currency: 'CAD',
        cardToken: 'card-token-123',
        orderId: 'order-456',
      });

      expect(result.status).toBe('declined');
      expect(result.declineReason).toBe('Insufficient funds');
    });

    it('should throw error for non-decline API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      await expect(
        paymentService.authorizePayment({
          merchantId: 'merchant-1',
          amount: 5000,
          currency: 'CAD',
          cardToken: 'card-token-123',
          orderId: 'order-456',
        })
      ).rejects.toThrow('Internal server error');
    });
  });

  describe('capturePayment', () => {
    it('should capture payment successfully', async () => {
      const mockResponse = {
        transactionId: 'tx-123',
        status: 'captured',
        capturedAmount: 50,
        timestamp: '2025-12-11T10:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await paymentService.capturePayment('tx-123');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://payment.test.com/api/v1/payments/tx-123/capture',
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        })
      );
    });

    it('should capture with specific amount', async () => {
      const mockResponse = {
        transactionId: 'tx-123',
        status: 'captured',
        capturedAmount: 25,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await paymentService.capturePayment('tx-123', 25);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.amount).toBe(25);
    });
  });

  describe('voidPayment', () => {
    it('should void payment successfully', async () => {
      const mockResponse = {
        transactionId: 'tx-123',
        status: 'voided',
        timestamp: '2025-12-11T10:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await paymentService.voidPayment('tx-123');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://payment.test.com/api/v1/payments/tx-123/void',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('refundPayment', () => {
    it('should refund payment successfully', async () => {
      const mockResponse = {
        transactionId: 'tx-123',
        status: 'refunded',
        refundedAmount: 25,
        timestamp: '2025-12-11T10:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await paymentService.refundPayment('tx-123', 25, 'Customer request');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://payment.test.com/api/v1/payments/tx-123/refund',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            amount: 25,
            reason: 'Customer request',
          }),
        })
      );
    });
  });

  describe('getPaymentStatus', () => {
    it('should get payment status successfully', async () => {
      const mockResponse = {
        transactionId: 'tx-123',
        status: 'captured',
        amount: 50,
        currency: 'CAD',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await paymentService.getPaymentStatus('tx-123');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://payment.test.com/api/v1/payments/tx-123',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('registerWebhook', () => {
    it('should register webhook successfully', async () => {
      const mockResponse = {
        id: 'webhook-1',
        merchantId: 'merchant-1',
        url: 'https://ssim.test.com/webhooks/payment',
        events: ['payment.authorized', 'payment.captured'],
        secret: 'webhook-secret',
        createdAt: '2025-12-11T10:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await paymentService.registerWebhook({
        merchantId: 'merchant-1',
        endpoint: 'https://ssim.test.com/webhooks/payment',
        events: ['payment.authorized', 'payment.captured'],
        secret: 'webhook-secret',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://payment.test.com/api/v1/webhooks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            merchantId: 'merchant-1',
            url: 'https://ssim.test.com/webhooks/payment',
            events: ['payment.authorized', 'payment.captured'],
            secret: 'webhook-secret',
          }),
        })
      );
    });
  });

  describe('listWebhooks', () => {
    it('should list webhooks successfully', async () => {
      const mockResponse = [
        {
          id: 'webhook-1',
          merchantId: 'merchant-1',
          url: 'https://ssim.test.com/webhooks/payment',
          events: ['payment.authorized'],
          createdAt: '2025-12-11T10:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await paymentService.listWebhooks('merchant-1');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://payment.test.com/api/v1/webhooks?merchantId=merchant-1',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('deleteWebhook', () => {
    it('should delete webhook successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await paymentService.deleteWebhook('webhook-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://payment.test.com/api/v1/webhooks/webhook-1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });
});
