// Mock the Prisma client - must be before imports
const mockPrismaOrder = {
  create: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
};

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    order: mockPrismaOrder,
  },
}));

import * as orderService from '../../services/order';

describe('Order Service', () => {
  const storeId = 'store-123';
  const userId = 'user-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('should create a new order', async () => {
      const params = {
        bsimUserId: userId,
        items: [
          { productId: 'prod-1', productName: 'Product 1', quantity: 2, unitPrice: 1000, subtotal: 2000 },
        ],
        subtotal: 2000,
        currency: 'CAD',
      };

      const mockOrder = {
        id: 'order-789',
        storeId,
        ...params,
        status: 'pending',
        createdAt: new Date(),
      };

      mockPrismaOrder.create.mockResolvedValue(mockOrder);

      const result = await orderService.createOrder(storeId, params);

      expect(result).toEqual(mockOrder);
      expect(mockPrismaOrder.create).toHaveBeenCalledWith({
        data: {
          storeId,
          bsimUserId: userId,
          storeUserId: undefined,
          items: params.items,
          subtotal: 2000,
          currency: 'CAD',
          status: 'pending',
        },
      });
    });
  });

  describe('getOrderById', () => {
    it('should return order when found', async () => {
      const mockOrder = { id: 'order-789', storeId, status: 'pending' };
      mockPrismaOrder.findFirst.mockResolvedValue(mockOrder);

      const result = await orderService.getOrderById(storeId, 'order-789');

      expect(result).toEqual(mockOrder);
      expect(mockPrismaOrder.findFirst).toHaveBeenCalledWith({
        where: { id: 'order-789', storeId },
      });
    });

    it('should return null when order not found', async () => {
      mockPrismaOrder.findFirst.mockResolvedValue(null);

      const result = await orderService.getOrderById(storeId, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getOrdersByUserId', () => {
    it('should return orders for user', async () => {
      const mockOrders = [
        { id: 'order-1', bsimUserId: userId, status: 'captured' },
        { id: 'order-2', bsimUserId: userId, status: 'pending' },
      ];
      mockPrismaOrder.findMany.mockResolvedValue(mockOrders);

      const result = await orderService.getOrdersByUserId(storeId, userId);

      expect(result).toEqual(mockOrders);
      expect(mockPrismaOrder.findMany).toHaveBeenCalledWith({
        where: { storeId, bsimUserId: userId },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array for user with no orders', async () => {
      mockPrismaOrder.findMany.mockResolvedValue([]);

      const result = await orderService.getOrdersByUserId(storeId, 'new-user');

      expect(result).toEqual([]);
    });
  });

  describe('getOrderByTransactionId', () => {
    it('should return order with matching transaction ID', async () => {
      const mockOrders = [
        { id: 'order-1', paymentDetails: { transactionId: 'tx-123' } },
        { id: 'order-2', paymentDetails: { transactionId: 'tx-456' } },
      ];
      mockPrismaOrder.findMany.mockResolvedValue(mockOrders);

      const result = await orderService.getOrderByTransactionId(storeId, 'tx-456');

      expect(result).toEqual(mockOrders[1]);
    });

    it('should return null when transaction ID not found', async () => {
      const mockOrders = [
        { id: 'order-1', paymentDetails: { transactionId: 'tx-123' } },
      ];
      mockPrismaOrder.findMany.mockResolvedValue(mockOrders);

      const result = await orderService.getOrderByTransactionId(storeId, 'tx-999');

      expect(result).toBeNull();
    });

    it('should handle orders with null paymentDetails', async () => {
      const mockOrders = [
        { id: 'order-1', paymentDetails: null },
        { id: 'order-2', paymentDetails: { transactionId: 'tx-123' } },
      ];
      mockPrismaOrder.findMany.mockResolvedValue(mockOrders);

      const result = await orderService.getOrderByTransactionId(storeId, 'tx-123');

      expect(result).toEqual(mockOrders[1]);
    });
  });

  describe('getAllOrders', () => {
    it('should return all orders for store', async () => {
      const mockOrders = [
        { id: 'order-1', status: 'captured' },
        { id: 'order-2', status: 'pending' },
      ];
      mockPrismaOrder.findMany.mockResolvedValue(mockOrders);

      const result = await orderService.getAllOrders(storeId);

      expect(result).toEqual(mockOrders);
      expect(mockPrismaOrder.findMany).toHaveBeenCalledWith({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getOrderStats', () => {
    it('should return order statistics', async () => {
      const mockOrders = [
        { status: 'pending', subtotal: 1000, paymentDetails: null },
        { status: 'authorized', subtotal: 2000, paymentDetails: null },
        { status: 'captured', subtotal: 3000, paymentDetails: { capturedAmount: 3000 } },
        { status: 'captured', subtotal: 4000, paymentDetails: { capturedAmount: 4000 } },
      ];
      mockPrismaOrder.findMany.mockResolvedValue(mockOrders);

      const result = await orderService.getOrderStats(storeId);

      expect(result).toEqual({
        total: 4,
        pending: 1,
        authorized: 1,
        captured: 2,
        revenue: 7000, // 3000 + 4000
      });
    });

    it('should return zeros for store with no orders', async () => {
      mockPrismaOrder.findMany.mockResolvedValue([]);

      const result = await orderService.getOrderStats(storeId);

      expect(result).toEqual({
        total: 0,
        pending: 0,
        authorized: 0,
        captured: 0,
        revenue: 0,
      });
    });

    it('should use subtotal when capturedAmount not set', async () => {
      const mockOrders = [
        { status: 'captured', subtotal: 5000, paymentDetails: null },
      ];
      mockPrismaOrder.findMany.mockResolvedValue(mockOrders);

      const result = await orderService.getOrderStats(storeId);

      expect(result.revenue).toBe(5000);
    });
  });

  describe('updateOrderStatus', () => {
    it('should update order status', async () => {
      const existing = { id: 'order-1', storeId, status: 'pending' };
      const updated = { ...existing, status: 'authorized' };

      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue(updated);

      const result = await orderService.updateOrderStatus(storeId, 'order-1', 'authorized');

      expect(result?.status).toBe('authorized');
      expect(mockPrismaOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'authorized' },
      });
    });

    it('should return null when order not found', async () => {
      mockPrismaOrder.findFirst.mockResolvedValue(null);

      const result = await orderService.updateOrderStatus(storeId, 'non-existent', 'authorized');

      expect(result).toBeNull();
      expect(mockPrismaOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('setOrderAuthorized', () => {
    it('should set order as authorized with payment details', async () => {
      const existing = { id: 'order-1', storeId, status: 'pending' };
      const updated = {
        ...existing,
        status: 'authorized',
        paymentDetails: {
          transactionId: 'tx-123',
          authorizationCode: 'auth-456',
          cardToken: 'card-token',
          paymentMethod: 'bank',
        },
      };

      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue(updated);

      const result = await orderService.setOrderAuthorized(
        storeId,
        'order-1',
        'tx-123',
        'auth-456',
        'card-token',
        'bank'
      );

      expect(result?.status).toBe('authorized');
      expect(mockPrismaOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: 'authorized',
          paymentDetails: {
            transactionId: 'tx-123',
            authorizationCode: 'auth-456',
            cardToken: 'card-token',
            paymentMethod: 'bank',
            walletCardToken: undefined,
          },
        },
      });
    });

    it('should set order as authorized with wallet payment details', async () => {
      const existing = { id: 'order-1', storeId, status: 'pending' };
      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue({ ...existing, status: 'authorized' });

      await orderService.setOrderAuthorized(
        storeId,
        'order-1',
        'tx-123',
        'auth-456',
        'card-token',
        'wallet',
        'wallet-card-token'
      );

      expect(mockPrismaOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: 'authorized',
          paymentDetails: {
            transactionId: 'tx-123',
            authorizationCode: 'auth-456',
            cardToken: 'card-token',
            paymentMethod: 'wallet',
            walletCardToken: 'wallet-card-token',
          },
        },
      });
    });
  });

  describe('setOrderCaptured', () => {
    it('should set order as captured with amount', async () => {
      const existing = {
        id: 'order-1',
        storeId,
        status: 'authorized',
        subtotal: 5000,
        paymentDetails: { transactionId: 'tx-123' },
      };
      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue({ ...existing, status: 'captured' });

      const result = await orderService.setOrderCaptured(storeId, 'order-1', 4000);

      expect(mockPrismaOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: 'captured',
          paymentDetails: {
            transactionId: 'tx-123',
            capturedAmount: 4000,
          },
        },
      });
    });

    it('should use subtotal when amount not specified', async () => {
      const existing = {
        id: 'order-1',
        storeId,
        status: 'authorized',
        subtotal: 5000,
        paymentDetails: { transactionId: 'tx-123' },
      };
      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue({ ...existing, status: 'captured' });

      await orderService.setOrderCaptured(storeId, 'order-1');

      expect(mockPrismaOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: 'captured',
          paymentDetails: {
            transactionId: 'tx-123',
            capturedAmount: 5000,
          },
        },
      });
    });
  });

  describe('setOrderRefunded', () => {
    it('should set order as refunded for full refund', async () => {
      const existing = {
        id: 'order-1',
        storeId,
        status: 'captured',
        subtotal: 5000,
        paymentDetails: { transactionId: 'tx-123', capturedAmount: 5000 },
      };
      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue({ ...existing, status: 'refunded' });

      await orderService.setOrderRefunded(storeId, 'order-1', 5000);

      expect(mockPrismaOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: 'refunded',
          paymentDetails: {
            transactionId: 'tx-123',
            capturedAmount: 5000,
            refundedAmount: 5000,
          },
        },
      });
    });

    it('should keep status as captured for partial refund', async () => {
      const existing = {
        id: 'order-1',
        storeId,
        status: 'captured',
        subtotal: 5000,
        paymentDetails: { transactionId: 'tx-123' },
      };
      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue({ ...existing });

      await orderService.setOrderRefunded(storeId, 'order-1', 2000);

      expect(mockPrismaOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: 'captured', // Still captured (partial refund)
          paymentDetails: {
            transactionId: 'tx-123',
            refundedAmount: 2000,
          },
        },
      });
    });

    it('should accumulate refunded amounts', async () => {
      const existing = {
        id: 'order-1',
        storeId,
        status: 'captured',
        subtotal: 5000,
        paymentDetails: { transactionId: 'tx-123', refundedAmount: 1000 },
      };
      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue({ ...existing });

      await orderService.setOrderRefunded(storeId, 'order-1', 2000);

      expect(mockPrismaOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: 'captured',
          paymentDetails: {
            transactionId: 'tx-123',
            refundedAmount: 3000, // 1000 + 2000
          },
        },
      });
    });
  });

  describe('setOrderVoided', () => {
    it('should set order as voided', async () => {
      const existing = { id: 'order-1', storeId, status: 'authorized' };
      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue({ ...existing, status: 'voided' });

      const result = await orderService.setOrderVoided(storeId, 'order-1');

      expect(result?.status).toBe('voided');
    });
  });

  describe('setOrderFailed', () => {
    it('should set order as failed', async () => {
      const existing = { id: 'order-1', storeId, status: 'pending' };
      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue({ ...existing, status: 'failed' });

      const result = await orderService.setOrderFailed(storeId, 'order-1');

      expect(result?.status).toBe('failed');
    });
  });

  describe('setOrderDeclined', () => {
    it('should set order as declined', async () => {
      const existing = { id: 'order-1', storeId, status: 'pending' };
      mockPrismaOrder.findFirst.mockResolvedValue(existing);
      mockPrismaOrder.update.mockResolvedValue({ ...existing, status: 'declined' });

      const result = await orderService.setOrderDeclined(storeId, 'order-1');

      expect(result?.status).toBe('declined');
    });
  });

  describe('getOrderItems', () => {
    it('should return typed order items', () => {
      const order = {
        items: [
          { productId: 'prod-1', productName: 'Product 1', quantity: 2, unitPrice: 1000, subtotal: 2000 },
        ],
      } as any;

      const result = orderService.getOrderItems(order);

      expect(result).toHaveLength(1);
      expect(result[0].productId).toBe('prod-1');
    });

    it('should return empty array for order with no items', () => {
      const order = { items: null } as any;

      const result = orderService.getOrderItems(order);

      expect(result).toEqual([]);
    });
  });

  describe('getOrderPaymentDetails', () => {
    it('should return typed payment details', () => {
      const order = {
        paymentDetails: {
          transactionId: 'tx-123',
          authorizationCode: 'auth-456',
        },
      } as any;

      const result = orderService.getOrderPaymentDetails(order);

      expect(result?.transactionId).toBe('tx-123');
      expect(result?.authorizationCode).toBe('auth-456');
    });

    it('should return null for order with no payment details', () => {
      const order = { paymentDetails: null } as any;

      const result = orderService.getOrderPaymentDetails(order);

      expect(result).toBeNull();
    });
  });
});
