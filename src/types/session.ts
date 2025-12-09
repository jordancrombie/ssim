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

export type PaymentProvider = 'bank' | 'wallet';

export interface PaymentState {
  orderId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  provider: PaymentProvider;
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
    // Admin fields
    adminReturnTo?: string;
    // Login redirect
    returnTo?: string;
    // Database user reference
    storeUserId?: string;
    // WSIM JWT (from database, for Quick Checkout)
    wsimJwt?: string;
    wsimJwtExp?: number;
  }
}
