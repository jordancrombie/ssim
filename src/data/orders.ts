import { Order, OrderStatus, CreateOrderParams, PaymentDetails } from '../models/order';
import { randomUUID } from 'crypto';

// In-memory order storage (replace with database in production)
const orders: Map<string, Order> = new Map();

export function createOrder(params: CreateOrderParams): Order {
  const id = `order-${randomUUID()}`;
  const now = new Date();

  const order: Order = {
    id,
    userId: params.userId,
    items: params.items,
    subtotal: params.subtotal,
    currency: params.currency,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  orders.set(id, order);
  return order;
}

export function getOrderById(id: string): Order | undefined {
  return orders.get(id);
}

export function getOrdersByUserId(userId: string): Order[] {
  return Array.from(orders.values())
    .filter(order => order.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function updateOrderStatus(id: string, status: OrderStatus): Order | undefined {
  const order = orders.get(id);
  if (!order) return undefined;

  order.status = status;
  order.updatedAt = new Date();
  orders.set(id, order);
  return order;
}

export function updateOrderPaymentDetails(id: string, paymentDetails: PaymentDetails): Order | undefined {
  const order = orders.get(id);
  if (!order) return undefined;

  order.paymentDetails = { ...order.paymentDetails, ...paymentDetails };
  order.updatedAt = new Date();
  orders.set(id, order);
  return order;
}

export function setOrderAuthorized(
  id: string,
  transactionId: string,
  authorizationCode: string,
  cardToken?: string
): Order | undefined {
  const order = orders.get(id);
  if (!order) return undefined;

  order.status = 'authorized';
  order.paymentDetails = {
    transactionId,
    authorizationCode,
    cardToken,
  };
  order.updatedAt = new Date();
  orders.set(id, order);
  return order;
}

export function setOrderCaptured(id: string, amount?: number): Order | undefined {
  const order = orders.get(id);
  if (!order || !order.paymentDetails) return undefined;

  order.status = 'captured';
  order.paymentDetails.capturedAmount = amount || order.subtotal;
  order.updatedAt = new Date();
  orders.set(id, order);
  return order;
}

export function setOrderRefunded(id: string, amount: number): Order | undefined {
  const order = orders.get(id);
  if (!order || !order.paymentDetails) return undefined;

  const currentRefunded = order.paymentDetails.refundedAmount || 0;
  order.paymentDetails.refundedAmount = currentRefunded + amount;

  // Full refund changes status to refunded
  if (order.paymentDetails.refundedAmount >= order.subtotal) {
    order.status = 'refunded';
  }

  order.updatedAt = new Date();
  orders.set(id, order);
  return order;
}

export function setOrderVoided(id: string): Order | undefined {
  const order = orders.get(id);
  if (!order) return undefined;

  order.status = 'voided';
  order.updatedAt = new Date();
  orders.set(id, order);
  return order;
}

export function setOrderFailed(id: string): Order | undefined {
  const order = orders.get(id);
  if (!order) return undefined;

  order.status = 'failed';
  order.updatedAt = new Date();
  orders.set(id, order);
  return order;
}

export function setOrderDeclined(id: string): Order | undefined {
  const order = orders.get(id);
  if (!order) return undefined;

  order.status = 'declined';
  order.updatedAt = new Date();
  orders.set(id, order);
  return order;
}
