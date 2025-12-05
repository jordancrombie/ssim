import dotenv from 'dotenv';

dotenv.config();

export interface OIDCProviderConfig {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

function parseProviders(): OIDCProviderConfig[] {
  const providersJson = process.env.OIDC_PROVIDERS;
  if (!providersJson) {
    console.warn('No OIDC_PROVIDERS configured');
    return [];
  }
  try {
    return JSON.parse(providersJson);
  } catch (e) {
    console.error('Failed to parse OIDC_PROVIDERS:', e);
    return [];
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3005', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3005',
  openbankingBaseUrl: process.env.OPENBANKING_BASE_URL || 'https://openbanking.banksim.ca',
  trustProxy: process.env.TRUST_PROXY === 'true',
  providers: parseProviders(),
  // Payment integration (NSIM)
  paymentApiUrl: process.env.PAYMENT_API_URL || 'https://payment-dev.banksim.ca',
  paymentAuthUrl: process.env.PAYMENT_AUTH_URL || 'https://auth-dev.banksim.ca',
  paymentApiKey: process.env.PAYMENT_API_KEY || '',
  merchantId: process.env.MERCHANT_ID || 'ssim-merchant',
  paymentClientId: process.env.PAYMENT_CLIENT_ID || 'ssim-client',
  paymentClientSecret: process.env.PAYMENT_CLIENT_SECRET || '',
  // Webhook configuration
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  // Admin configuration
  adminEnabled: process.env.ADMIN_ENABLED !== 'false', // enabled by default
  adminEmails: process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [],
  // WSIM (Wallet) integration
  wsimEnabled: process.env.WSIM_ENABLED === 'true',
  wsimAuthUrl: process.env.WSIM_AUTH_URL || '',
  wsimClientId: process.env.WSIM_CLIENT_ID || 'ssim-merchant',
  wsimClientSecret: process.env.WSIM_CLIENT_SECRET || '',
};
