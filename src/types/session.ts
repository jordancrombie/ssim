import 'express-session';

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface PendingOrder {
  id: string;
  items: CartItem[];
  subtotal: number;
  currency: string;
  createdAt: Date;
}

export interface PaymentState {
  orderId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

declare module 'express-session' {
  interface SessionData {
    // Existing OIDC fields
    oidcState?: string;
    oidcNonce?: string;
    codeVerifier?: string;
    providerId?: string;
    userInfo?: Record<string, unknown>;
    tokenSet?: {
      access_token?: string;
      id_token?: string;
      refresh_token?: string;
      expires_at?: number;
      scope?: string;
    };
    // Cart and payment fields
    cart?: CartItem[];
    pendingOrder?: PendingOrder;
    paymentState?: PaymentState;
    cardToken?: string;
  }
}
