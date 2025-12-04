import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import path from 'path';
import { config } from './config/env';
import { initializeProviders } from './config/oidc';
import authRoutes from './routes/auth';
import pageRoutes from './routes/pages';
import apiRoutes from './routes/api';
import cartRoutes from './routes/cart';
import paymentRoutes from './routes/payment';
import webhookRoutes from './routes/webhooks';
import adminRoutes from './routes/admin';
import { registerWebhook } from './services/payment';

const app = express();

// Trust proxy when running behind ALB/nginx (required for secure cookies over HTTPS)
if (config.trustProxy) {
  app.set('trust proxy', 1);
  console.log('Trust proxy enabled for production deployment');
}

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(cors({
  origin: config.appBaseUrl,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session configuration
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// Static files
app.use('/static', express.static(path.join(__dirname, 'public')));

// Serve logo at root for OIDC providers to display during authentication
app.use('/logo.png', express.static(path.join(__dirname, 'public', 'logo.png')));

// Routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/cart', cartRoutes);
app.use('/payment', paymentRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/admin', adminRoutes);
app.use('/', pageRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// Register webhook with NSIM on startup
async function registerPaymentWebhook(): Promise<void> {
  const webhookEndpoint = `${config.appBaseUrl}/webhooks/payment`;
  const events = [
    'payment.authorized',
    'payment.captured',
    'payment.voided',
    'payment.refunded',
    'payment.declined',
    'payment.expired',
    'payment.failed',
  ];

  try {
    console.log('[Startup] Registering webhook with NSIM...');
    const result = await registerWebhook({
      merchantId: config.merchantId,
      endpoint: webhookEndpoint,
      events,
      secret: config.webhookSecret || undefined,
    });
    console.log('[Startup] Webhook registered successfully:', result.id);
  } catch (error) {
    // Log but don't fail startup - webhook registration is not critical
    console.warn('[Startup] Failed to register webhook (non-fatal):', error instanceof Error ? error.message : error);
    console.warn('[Startup] Payment status updates may need manual refresh');
  }
}

// Start server
async function start() {
  try {
    // Initialize OIDC providers
    await initializeProviders();

    app.listen(config.port, () => {
      console.log(`SSIM Store Simulator running on port ${config.port}`);
      console.log(`Visit: ${config.appBaseUrl}`);
    });

    // Register webhook after server is listening (non-blocking)
    registerPaymentWebhook();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
