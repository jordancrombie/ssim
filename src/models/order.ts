import { CartItem } from '../types/session';

export type OrderStatus = 'pending' | 'authorized' | 'captured' | 'voided' | 'refunded' | 'declined' | 'expired' | 'failed';

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number; // in cents
  subtotal: number; // in cents
}

export interface PaymentDetails {
  transactionId: string;
  authorizationCode?: string;
  cardToken?: string;
  capturedAmount?: number;
  refundedAmount?: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  subtotal: number; // in cents
  currency: string;
  status: OrderStatus;
  paymentDetails?: PaymentDetails;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderParams {
  userId: string;
  items: OrderItem[];
  subtotal: number;
  currency: string;
}
