/**
 * Terminal Service
 *
 * Manages hardware payment terminals (ESP32 devices) that display QR codes.
 * Handles terminal registration, status tracking, and payment orchestration.
 */

import { Terminal, TerminalPairingCode } from '@prisma/client';
import crypto from 'crypto';
import { config } from '../config/env';
import prisma from '../lib/prisma';

// WSIM API response types
interface WsimPaymentRequestResponse {
  requestId: string;
  expiresAt?: string;
}

interface WsimPaymentStatusResponse {
  status: string;
  message?: string;
  transactionId?: string;
  oneTimePaymentToken?: string;
}

// In-memory registry of connected terminals (WebSocket connections)
// Key: terminalId, Value: { ws: WebSocket, lastHeartbeat: Date }
interface TerminalConnection {
  ws: unknown; // WebSocket instance (set by WebSocket server)
  lastHeartbeat: Date;
}

const connectedTerminals = new Map<string, TerminalConnection>();

// In-memory payment sessions (active payments waiting for approval)
interface PaymentSession {
  paymentId: string;
  storeId: string;
  terminalId: string;
  amount: number;
  currency: string;
  reference?: string;
  status: 'pending' | 'approved' | 'declined' | 'failed' | 'cancelled' | 'expired';
  qrCodeUrl?: string;
  wsimRequestId?: string;
  createdAt: Date;
  expiresAt: Date;
}

const paymentSessions = new Map<string, PaymentSession>();

// ============================================
// Terminal Management
// ============================================

/**
 * Get all terminals for a store
 */
export async function getTerminals(storeId: string): Promise<Terminal[]> {
  return prisma.terminal.findMany({
    where: { storeId },
    orderBy: { name: 'asc' },
  });
}

/**
 * Get a single terminal by ID
 */
export async function getTerminal(terminalId: string): Promise<Terminal | null> {
  return prisma.terminal.findUnique({
    where: { id: terminalId },
  });
}

/**
 * Get terminal by API key (for authentication)
 */
export async function getTerminalByApiKey(apiKey: string): Promise<Terminal | null> {
  return prisma.terminal.findUnique({
    where: { apiKey },
  });
}

/**
 * Create a new terminal with a pairing code
 */
export async function createTerminal(
  storeId: string,
  name: string
): Promise<{ terminal: Terminal; pairingCode: string }> {
  // Generate unique API key
  const apiKey = `tkey_${crypto.randomBytes(32).toString('hex')}`;

  // Create terminal
  const terminal = await prisma.terminal.create({
    data: {
      storeId,
      name,
      apiKey,
      status: 'pairing',
    },
  });

  // Generate 6-digit pairing code
  const pairingCode = generatePairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await prisma.terminalPairingCode.create({
    data: {
      storeId,
      code: pairingCode,
      terminalId: terminal.id,
      terminalName: name,
      expiresAt,
    },
  });

  return { terminal, pairingCode };
}

/**
 * Complete terminal pairing
 */
export async function completePairing(
  pairingCode: string,
  deviceInfo: {
    model?: string;
    firmwareVersion?: string;
    macAddress?: string;
  }
): Promise<{ terminal: Terminal; apiKey: string } | null> {
  // Find valid pairing code
  const pairing = await prisma.terminalPairingCode.findFirst({
    where: {
      code: pairingCode,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!pairing || !pairing.terminalId) {
    return null;
  }

  // Update terminal with device info
  const terminal = await prisma.terminal.update({
    where: { id: pairing.terminalId },
    data: {
      status: 'offline', // Will become 'online' when WebSocket connects
      deviceModel: deviceInfo.model,
      firmwareVersion: deviceInfo.firmwareVersion,
      macAddress: deviceInfo.macAddress,
    },
  });

  // Mark pairing code as used
  await prisma.terminalPairingCode.update({
    where: { id: pairing.id },
    data: { usedAt: new Date() },
  });

  return { terminal, apiKey: terminal.apiKey };
}

/**
 * Update terminal status
 */
export async function updateTerminalStatus(
  terminalId: string,
  status: 'online' | 'offline',
  ipAddress?: string
): Promise<Terminal> {
  return prisma.terminal.update({
    where: { id: terminalId },
    data: {
      status,
      lastSeenAt: new Date(),
      lastIpAddress: ipAddress,
    },
  });
}

/**
 * Delete a terminal
 */
export async function deleteTerminal(storeId: string, terminalId: string): Promise<void> {
  // Verify terminal belongs to store
  const terminal = await prisma.terminal.findFirst({
    where: { id: terminalId, storeId },
  });

  if (!terminal) {
    throw new Error('Terminal not found');
  }

  // Disconnect if connected
  disconnectTerminal(terminalId);

  // Delete terminal
  await prisma.terminal.delete({
    where: { id: terminalId },
  });
}

// ============================================
// Terminal Connection Registry
// ============================================

/**
 * Register a terminal connection (called by WebSocket server)
 */
export function registerTerminalConnection(terminalId: string, ws: unknown): void {
  connectedTerminals.set(terminalId, {
    ws,
    lastHeartbeat: new Date(),
  });
}

/**
 * Unregister a terminal connection
 */
export function unregisterTerminalConnection(terminalId: string): void {
  connectedTerminals.delete(terminalId);
}

/**
 * Get a terminal's WebSocket connection
 */
export function getTerminalConnection(terminalId: string): TerminalConnection | undefined {
  return connectedTerminals.get(terminalId);
}

/**
 * Check if a terminal is connected
 */
export function isTerminalConnected(terminalId: string): boolean {
  return connectedTerminals.has(terminalId);
}

/**
 * Disconnect a terminal (close WebSocket)
 */
export function disconnectTerminal(terminalId: string): void {
  const connection = connectedTerminals.get(terminalId);
  if (connection && connection.ws) {
    // WebSocket close will be handled by the WebSocket server
    connectedTerminals.delete(terminalId);
  }
}

/**
 * Update terminal heartbeat (in-memory only)
 */
export function updateHeartbeat(terminalId: string): void {
  const connection = connectedTerminals.get(terminalId);
  if (connection) {
    connection.lastHeartbeat = new Date();
  }
}

/**
 * Process heartbeat from terminal - updates database with status and device info
 *
 * Heartbeat payload may include:
 * - firmwareVersion: Current firmware version
 * - ipAddress: Terminal's local IP address
 * - uptime: Seconds since boot
 * - freeMemory: Available memory in bytes
 * - wifiRssi: WiFi signal strength
 */
export async function processHeartbeat(
  terminalId: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    const updateData: {
      status: string;
      lastSeenAt: Date;
      firmwareVersion?: string;
      lastIpAddress?: string;
    } = {
      status: 'online',
      lastSeenAt: new Date(),
    };

    // Extract device info from heartbeat payload
    if (payload) {
      if (typeof payload.firmwareVersion === 'string') {
        updateData.firmwareVersion = payload.firmwareVersion;
      }
      if (typeof payload.ipAddress === 'string') {
        updateData.lastIpAddress = payload.ipAddress;
      }
    }

    await prisma.terminal.update({
      where: { id: terminalId },
      data: updateData,
    });
  } catch (error) {
    console.error(`[Terminal] Failed to process heartbeat for ${terminalId}:`, error);
  }
}

/**
 * Get all connected terminal IDs
 */
export function getConnectedTerminalIds(): string[] {
  return Array.from(connectedTerminals.keys());
}

// ============================================
// Payment Sessions
// ============================================

/**
 * Initiate a payment on a terminal
 *
 * Creates a payment request via WSIM mobile API and sends the QR code
 * to the terminal via WebSocket for display.
 */
export async function initiatePayment(params: {
  storeId: string;
  terminalId: string;
  amount: number;
  currency: string;
  reference?: string;
  storeName?: string;
}): Promise<PaymentSession> {
  const { storeId, terminalId, amount, currency, reference, storeName } = params;

  // Generate payment ID
  const paymentId = `tpay_${crypto.randomBytes(16).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Create payment session
  const session: PaymentSession = {
    paymentId,
    storeId,
    terminalId,
    amount,
    currency,
    reference,
    status: 'pending',
    createdAt: new Date(),
    expiresAt,
  };

  // Check if WSIM mobile API is configured
  if (!config.wsimMobileApiUrl || !config.wsimApiKey) {
    console.warn('[Terminal] WSIM mobile API not configured, using stub mode');
    // Stub mode for development/testing
    const stubRequestId = `terminal-stub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    session.wsimRequestId = stubRequestId;
    session.qrCodeUrl = `${config.wsimQrBaseUrl}/${stubRequestId}`;
    paymentSessions.set(paymentId, session);

    // Send to terminal via WebSocket (even in stub mode for testing)
    sendPaymentToTerminal(terminalId, session);

    return session;
  }

  try {
    // Call WSIM mobile payment API to create payment request
    console.log('[Terminal] Creating payment request via WSIM API...');

    const wsimResponse = await fetch(`${config.wsimMobileApiUrl}/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.wsimApiKey,
      },
      body: JSON.stringify({
        amount: (amount / 100).toFixed(2), // Convert cents to dollars
        currency,
        orderId: reference || paymentId,
        orderDescription: `Terminal payment: ${reference || paymentId}`,
        merchantName: storeName || 'SSIM Store',
        merchantLogoUrl: `${config.appBaseUrl}/logo-256.png`,
      }),
    });

    if (!wsimResponse.ok) {
      const errorData = await wsimResponse.json().catch(() => ({})) as { message?: string };
      console.error('[Terminal] WSIM API error:', wsimResponse.status, errorData);
      throw new Error(errorData.message || `WSIM API error: ${wsimResponse.status}`);
    }

    const wsimData = await wsimResponse.json() as WsimPaymentRequestResponse;
    console.log('[Terminal] WSIM payment request created:', wsimData.requestId);

    // Update session with WSIM data
    session.wsimRequestId = wsimData.requestId;
    session.qrCodeUrl = `${config.wsimQrBaseUrl}/${wsimData.requestId}`;
    if (wsimData.expiresAt) {
      session.expiresAt = new Date(wsimData.expiresAt);
    }

    paymentSessions.set(paymentId, session);

    // Send to terminal via WebSocket
    sendPaymentToTerminal(terminalId, session);

    return session;
  } catch (error) {
    console.error('[Terminal] Failed to create payment request:', error);
    session.status = 'failed';
    paymentSessions.set(paymentId, session);
    throw error;
  }
}

/**
 * Send payment request to terminal via WebSocket
 */
function sendPaymentToTerminal(terminalId: string, session: PaymentSession): void {
  // Dynamic import to avoid circular dependency
  // The WebSocket module is imported at runtime
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wsModule = require('./terminal-websocket');
    if (wsModule.sendPaymentRequest) {
      const sent = wsModule.sendPaymentRequest(
        terminalId,
        session.paymentId,
        session.qrCodeUrl || '',
        session.amount,
        session.currency,
        session.reference,
        session.expiresAt
      );
      if (sent) {
        console.log(`[Terminal] Payment ${session.paymentId} sent to terminal ${terminalId}`);
      } else {
        console.warn(`[Terminal] Could not send payment to terminal ${terminalId} (not connected)`);
      }
    }
  } catch (error) {
    console.error('[Terminal] Error sending payment to terminal:', error);
  }
}

/**
 * Get payment status
 */
export function getPaymentStatus(
  storeId: string,
  paymentId: string
): PaymentSession | null {
  const session = paymentSessions.get(paymentId);
  if (!session || session.storeId !== storeId) {
    return null;
  }

  // Check if expired
  if (session.status === 'pending' && new Date() > session.expiresAt) {
    session.status = 'expired';
  }

  return session;
}

/**
 * Update payment status
 */
export function updatePaymentStatus(
  paymentId: string,
  status: PaymentSession['status']
): void {
  const session = paymentSessions.get(paymentId);
  if (session) {
    session.status = status;
  }
}

/**
 * Cancel a payment
 */
export async function cancelPayment(storeId: string, paymentId: string): Promise<void> {
  const session = paymentSessions.get(paymentId);
  if (!session || session.storeId !== storeId) {
    throw new Error('Payment not found');
  }

  if (session.status !== 'pending') {
    throw new Error('Payment cannot be cancelled');
  }

  session.status = 'cancelled';

  // Send cancel message to terminal via WebSocket
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wsModule = require('./terminal-websocket');
    if (wsModule.sendPaymentCancel) {
      wsModule.sendPaymentCancel(session.terminalId, paymentId);
      console.log(`[Terminal] Payment ${paymentId} cancelled on terminal ${session.terminalId}`);
    }
  } catch (error) {
    console.error('[Terminal] Error sending cancel to terminal:', error);
  }

  // Cancel WSIM payment request if created
  if (session.wsimRequestId && config.wsimMobileApiUrl && config.wsimApiKey) {
    try {
      await fetch(`${config.wsimMobileApiUrl}/${session.wsimRequestId}/cancel`, {
        method: 'POST',
        headers: {
          'X-API-Key': config.wsimApiKey,
        },
      });
      console.log(`[Terminal] WSIM payment ${session.wsimRequestId} cancelled`);
    } catch (error) {
      console.warn('[Terminal] Failed to cancel WSIM payment (non-fatal):', error);
    }
  }
}

/**
 * Get active payments for a store
 */
export function getActivePayments(storeId: string): PaymentSession[] {
  const active: PaymentSession[] = [];

  for (const session of paymentSessions.values()) {
    if (session.storeId === storeId && session.status === 'pending') {
      // Check if expired
      if (new Date() > session.expiresAt) {
        session.status = 'expired';
      } else {
        active.push(session);
      }
    }
  }

  return active;
}

/**
 * Clean up expired sessions (called periodically)
 */
export function cleanupExpiredSessions(): number {
  const now = new Date();
  let cleaned = 0;

  for (const [paymentId, session] of paymentSessions.entries()) {
    // Remove sessions older than 1 hour
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    if (session.createdAt < oneHourAgo) {
      paymentSessions.delete(paymentId);
      cleaned++;
    }
  }

  return cleaned;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Generate a 6-digit pairing code
 */
function generatePairingCode(): string {
  // Generate cryptographically secure 6-digit code
  const code = crypto.randomInt(100000, 999999).toString();
  return code;
}

/**
 * Generate a new pairing code for an existing terminal
 */
export async function regeneratePairingCode(
  storeId: string,
  terminalId: string
): Promise<string> {
  // Verify terminal belongs to store
  const terminal = await prisma.terminal.findFirst({
    where: { id: terminalId, storeId },
  });

  if (!terminal) {
    throw new Error('Terminal not found');
  }

  // Generate new pairing code
  const pairingCode = generatePairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Invalidate any existing unused codes for this terminal
  await prisma.terminalPairingCode.updateMany({
    where: {
      terminalId,
      usedAt: null,
    },
    data: {
      expiresAt: new Date(0), // Expire immediately
    },
  });

  // Create new pairing code
  await prisma.terminalPairingCode.create({
    data: {
      storeId,
      code: pairingCode,
      terminalId,
      terminalName: terminal.name,
      expiresAt,
    },
  });

  // Update terminal status
  await prisma.terminal.update({
    where: { id: terminalId },
    data: { status: 'pairing' },
  });

  return pairingCode;
}
