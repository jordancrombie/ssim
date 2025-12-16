import prisma from '../lib/prisma';
import type { Order } from '@prisma/client';

// Re-export the Prisma Order type
export type { Order };

// Order status types
export type OrderStatus = 'pending' | 'authorized' | 'captured' | 'voided' | 'refunded' | 'declined' | 'expired' | 'failed';
export type PaymentMethod = 'bank' | 'wallet';

// Order item structure (stored as JSON)
export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number; // in cents
  subtotal: number; // in cents
}

// Payment details structure (stored as JSON)
export interface PaymentDetails {
  transactionId: string;
  authorizationCode?: string;
  cardToken?: string;
  walletCardToken?: string;
  paymentMethod?: PaymentMethod;
  capturedAmount?: number;
  refundedAmount?: number;
}

export interface CreateOrderParams {
  bsimUserId: string;
  storeUserId?: string;
  items: OrderItem[];
  subtotal: number;
  currency: string;
  mobilePaymentRequestId?: string; // For mwsim mobile wallet payments
}

/**
 * Create a new order
 */
export async function createOrder(storeId: string, params: CreateOrderParams): Promise<Order> {
  return prisma.order.create({
    data: {
      storeId,
      bsimUserId: params.bsimUserId,
      storeUserId: params.storeUserId,
      items: params.items as any,
      subtotal: params.subtotal,
      currency: params.currency,
      status: 'pending',
      mobilePaymentRequestId: params.mobilePaymentRequestId,
    },
  });
}

/**
 * Get order by ID
 */
export async function getOrderById(storeId: string, orderId: string): Promise<Order | null> {
  return prisma.order.findFirst({
    where: {
      id: orderId,
      storeId,
    },
  });
}

/**
 * Get orders by user ID (BSIM user sub)
 */
export async function getOrdersByUserId(storeId: string, bsimUserId: string): Promise<Order[]> {
  return prisma.order.findMany({
    where: {
      storeId,
      bsimUserId,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get order by transaction ID
 */
export async function getOrderByTransactionId(storeId: string, transactionId: string): Promise<Order | null> {
  const orders = await prisma.order.findMany({
    where: { storeId },
  });

  // Search in JSON paymentDetails
  for (const order of orders) {
    const details = order.paymentDetails as PaymentDetails | null;
    if (details?.transactionId === transactionId) {
      return order;
    }
  }

  return null;
}

/**
 * Get order by mobile payment request ID
 * Used for cross-tab lookup when mwsim opens a new tab
 */
export async function getOrderByMobilePaymentRequestId(storeId: string, requestId: string): Promise<Order | null> {
  return prisma.order.findFirst({
    where: {
      storeId,
      mobilePaymentRequestId: requestId,
    },
  });
}

/**
 * Get all orders for a store
 */
export async function getAllOrders(storeId: string): Promise<Order[]> {
  return prisma.order.findMany({
    where: { storeId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get order statistics for admin dashboard
 */
export async function getOrderStats(storeId: string): Promise<{
  total: number;
  pending: number;
  authorized: number;
  captured: number;
  revenue: number;
}> {
  const orders = await prisma.order.findMany({
    where: { storeId },
  });

  const pending = orders.filter(o => o.status === 'pending').length;
  const authorized = orders.filter(o => o.status === 'authorized').length;
  const captured = orders.filter(o => o.status === 'captured');

  const revenue = captured.reduce((sum, o) => {
    const details = o.paymentDetails as PaymentDetails | null;
    return sum + (details?.capturedAmount || o.subtotal);
  }, 0);

  return {
    total: orders.length,
    pending,
    authorized,
    captured: captured.length,
    revenue,
  };
}

/**
 * Update order status
 */
export async function updateOrderStatus(storeId: string, orderId: string, status: OrderStatus): Promise<Order | null> {
  const existing = await prisma.order.findFirst({
    where: { id: orderId, storeId },
  });

  if (!existing) return null;

  return prisma.order.update({
    where: { id: orderId },
    data: { status },
  });
}

/**
 * Update order payment details
 */
export async function updateOrderPaymentDetails(
  storeId: string,
  orderId: string,
  paymentDetails: Partial<PaymentDetails>
): Promise<Order | null> {
  const existing = await prisma.order.findFirst({
    where: { id: orderId, storeId },
  });

  if (!existing) return null;

  const currentDetails = (existing.paymentDetails as PaymentDetails | null) || {};
  const newDetails = { ...currentDetails, ...paymentDetails };

  return prisma.order.update({
    where: { id: orderId },
    data: { paymentDetails: newDetails as any },
  });
}

/**
 * Set order as authorized
 */
export async function setOrderAuthorized(
  storeId: string,
  orderId: string,
  transactionId: string,
  authorizationCode: string,
  cardToken?: string,
  paymentMethod: PaymentMethod = 'bank',
  walletCardToken?: string
): Promise<Order | null> {
  const existing = await prisma.order.findFirst({
    where: { id: orderId, storeId },
  });

  if (!existing) return null;

  const paymentDetails: PaymentDetails = {
    transactionId,
    authorizationCode,
    cardToken,
    paymentMethod,
    walletCardToken,
  };

  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'authorized',
      paymentDetails: paymentDetails as any,
    },
  });
}

/**
 * Set order as captured
 */
export async function setOrderCaptured(storeId: string, orderId: string, amount?: number): Promise<Order | null> {
  const existing = await prisma.order.findFirst({
    where: { id: orderId, storeId },
  });

  if (!existing) return null;

  const currentDetails: PaymentDetails = (existing.paymentDetails as PaymentDetails | null) || { transactionId: '' };
  const newDetails: PaymentDetails = {
    ...currentDetails,
    transactionId: currentDetails.transactionId || '',
    capturedAmount: amount || existing.subtotal,
  };

  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'captured',
      paymentDetails: newDetails as any,
    },
  });
}

/**
 * Set order as refunded
 */
export async function setOrderRefunded(storeId: string, orderId: string, amount: number): Promise<Order | null> {
  const existing = await prisma.order.findFirst({
    where: { id: orderId, storeId },
  });

  if (!existing) return null;

  const currentDetails: PaymentDetails = (existing.paymentDetails as PaymentDetails | null) || { transactionId: '' };
  const currentRefunded = currentDetails.refundedAmount || 0;
  const newRefunded = currentRefunded + amount;

  // Full refund changes status to refunded
  const newStatus = newRefunded >= existing.subtotal ? 'refunded' : existing.status;

  const newDetails: PaymentDetails = {
    ...currentDetails,
    transactionId: currentDetails.transactionId || '',
    refundedAmount: newRefunded,
  };

  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: newStatus,
      paymentDetails: newDetails as any,
    },
  });
}

/**
 * Set order as voided
 */
export async function setOrderVoided(storeId: string, orderId: string): Promise<Order | null> {
  return updateOrderStatus(storeId, orderId, 'voided');
}

/**
 * Set order as failed
 */
export async function setOrderFailed(storeId: string, orderId: string): Promise<Order | null> {
  return updateOrderStatus(storeId, orderId, 'failed');
}

/**
 * Set order as declined
 */
export async function setOrderDeclined(storeId: string, orderId: string): Promise<Order | null> {
  return updateOrderStatus(storeId, orderId, 'declined');
}

/**
 * Get order items (typed accessor)
 */
export function getOrderItems(order: Order): OrderItem[] {
  return (order.items as unknown as OrderItem[]) || [];
}

/**
 * Get order payment details (typed accessor)
 */
export function getOrderPaymentDetails(order: Order): PaymentDetails | null {
  return (order.paymentDetails as PaymentDetails | null) || null;
}
