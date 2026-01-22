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
  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/ssim',
  // Store identity (for multi-tenant DB)
  storeDomain: process.env.STORE_DOMAIN || new URL(process.env.APP_BASE_URL || 'http://localhost:3005').hostname,
  storeName: process.env.STORE_NAME || 'SSIM Store',
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
  // WSIM Popup URL (for embedded wallet payment flow)
  wsimPopupUrl: process.env.WSIM_POPUP_URL || 'https://wsim-auth-dev.banksim.ca',
  // WSIM Merchant API (for custom card selection UI)
  wsimApiKey: process.env.WSIM_API_KEY || '',
  wsimApiUrl: process.env.WSIM_API_URL || 'https://wsim-dev.banksim.ca/api/merchant',
  // WSIM Mobile Payment API (for mwsim app integration)
  wsimMobileApiUrl: process.env.WSIM_MOBILE_API_URL || 'https://wsim-dev.banksim.ca/api/mobile/payment',
  // WSIM QR Payment URL base (for generating QR code payment links)
  // This is the user-facing URL that QR codes point to, which redirects to mwsim app
  wsimQrBaseUrl: process.env.WSIM_QR_BASE_URL || 'https://wsim-dev.banksim.ca/pay',

  // Agent Commerce (SACP) configuration
  agentApiEnabled: process.env.AGENT_API_ENABLED === 'true',
  // WSIM Agent API endpoint for token introspection
  wsimAgentApiUrl: process.env.WSIM_AGENT_API_URL || 'https://wsim-dev.banksim.ca/api/agent/v1',
  // WSIM Agent introspection credentials (separate from OAuth merchant credentials)
  wsimIntrospectionClientId: process.env.WSIM_INTROSPECTION_CLIENT_ID || process.env.WSIM_CLIENT_ID || 'ssim-merchant',
  wsimIntrospectionClientSecret: process.env.WSIM_INTROSPECTION_CLIENT_SECRET || process.env.WSIM_CLIENT_SECRET || '',
  // Token cache TTL in seconds (approved: 60 seconds per Q18)
  agentTokenCacheTtl: parseInt(process.env.AGENT_TOKEN_CACHE_TTL || '60', 10),
  // Session expiration in minutes (default 30, configurable 5-60 per Q1)
  agentSessionExpirationMinutes: Math.min(60, Math.max(5, parseInt(process.env.AGENT_SESSION_EXPIRATION_MINUTES || '30', 10))),
  // Rate limiting (requests per minute per agent, default 1000 per Q20)
  agentRateLimitPerMinute: parseInt(process.env.AGENT_RATE_LIMIT_PER_MINUTE || '1000', 10),
};
