/**
 * Terminal WebSocket Server
 *
 * Handles real-time communication with ESP32 payment terminals.
 * Terminals connect via WebSocket for receiving payment requests
 * and sending status updates.
 *
 * IMPORTANT: Only accepts connections from terminals belonging to THIS instance's store.
 * This ensures proper isolation when multiple SSIM instances share a database.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import { URL } from 'url';
import * as terminalService from './terminal';
import { config } from '../config/env';
import { getOrCreateStore } from './store';
import type { Store } from '@prisma/client';

// Store reference (cached for process lifecycle)
let currentStore: Store | null = null;

async function ensureStore(): Promise<Store> {
  if (!currentStore) {
    currentStore = await getOrCreateStore();
  }
  return currentStore;
}

// Message types from terminal
interface TerminalMessage {
  type: 'heartbeat' | 'payment_status' | 'error';
  payload?: Record<string, unknown>;
}

// Message types to terminal
interface ServerMessage {
  type: 'payment_request' | 'payment_cancel' | 'payment_complete' | 'config_update' | 'pong';
  payload?: Record<string, unknown>;
}

// Extended WebSocket with terminal info
interface TerminalSocket extends WebSocket {
  terminalId?: string;
  storeId?: string;
  isAlive: boolean;
}

let wss: WebSocketServer | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Initialize WebSocket server attached to HTTP server
 */
export function initializeWebSocket(server: Server): void {
  wss = new WebSocketServer({
    server,
    path: '/terminal/ws',
    verifyClient: verifyClient,
  });

  wss.on('connection', handleConnection);

  // Heartbeat check every 30 seconds
  heartbeatInterval = setInterval(() => {
    wss?.clients.forEach((ws) => {
      const terminalWs = ws as TerminalSocket;
      if (!terminalWs.isAlive) {
        console.log(`[Terminal WS] Terminal ${terminalWs.terminalId} failed heartbeat check, disconnecting`);
        return terminalWs.terminate();
      }
      terminalWs.isAlive = false;
      terminalWs.ping();
    });
  }, 30000);

  wss.on('close', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  });

  console.log('[Terminal WS] WebSocket server initialized on /terminal/ws');
}

/**
 * Verify client connection before upgrade
 * Checks for valid API key in query string or header
 * IMPORTANT: Only accepts terminals belonging to THIS store
 */
async function verifyClient(
  info: { origin: string; secure: boolean; req: IncomingMessage },
  callback: (result: boolean, code?: number, message?: string) => void
): Promise<void> {
  try {
    const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
    const apiKey = url.searchParams.get('apiKey') ||
                   info.req.headers['x-api-key'] as string;

    if (!apiKey) {
      console.log('[Terminal WS] Connection rejected: No API key provided');
      callback(false, 401, 'API key required');
      return;
    }

    const terminal = await terminalService.getTerminalByApiKey(apiKey);
    if (!terminal) {
      console.log('[Terminal WS] Connection rejected: Invalid API key');
      callback(false, 401, 'Invalid API key');
      return;
    }

    // Verify terminal belongs to THIS store - critical for multi-instance isolation
    const store = await ensureStore();
    if (terminal.storeId !== store.id) {
      console.warn(`[Terminal WS] Connection rejected: Terminal ${terminal.id} belongs to store ${terminal.storeId}, not ${store.id} (${store.name})`);
      callback(false, 401, 'Terminal not registered with this store');
      return;
    }

    // Store terminal info in request for use in connection handler
    (info.req as IncomingMessage & { terminal: typeof terminal }).terminal = terminal;
    callback(true);
  } catch (error) {
    console.error('[Terminal WS] Verification error:', error);
    callback(false, 500, 'Internal server error');
  }
}

/**
 * Handle new WebSocket connection
 */
async function handleConnection(
  ws: WebSocket,
  req: IncomingMessage
): Promise<void> {
  const terminalWs = ws as TerminalSocket;
  const terminal = (req as IncomingMessage & { terminal: { id: string; storeId: string; name: string } }).terminal;

  if (!terminal) {
    ws.close(1008, 'Authentication failed');
    return;
  }

  terminalWs.terminalId = terminal.id;
  terminalWs.storeId = terminal.storeId;
  terminalWs.isAlive = true;

  // Register connection
  terminalService.registerTerminalConnection(terminal.id, ws);

  // Update terminal status to online
  const clientIp = req.socket.remoteAddress ||
                   (req.headers['x-forwarded-for'] as string)?.split(',')[0];
  await terminalService.updateTerminalStatus(terminal.id, 'online', clientIp);

  console.log(`[Terminal WS] Terminal connected: ${terminal.name} (${terminal.id})`);

  // Handle pong (response to ping)
  ws.on('pong', () => {
    terminalWs.isAlive = true;
    terminalService.updateHeartbeat(terminal.id);
  });

  // Handle messages
  ws.on('message', async (data) => {
    try {
      const message: TerminalMessage = JSON.parse(data.toString());
      await handleMessage(terminalWs, message);
    } catch (error) {
      console.error(`[Terminal WS] Invalid message from ${terminal.id}:`, error);
    }
  });

  // Handle close
  ws.on('close', async () => {
    console.log(`[Terminal WS] Terminal disconnected: ${terminal.name} (${terminal.id})`);
    // Pass ws reference to prevent race condition where stale close event
    // removes a newer connection's entry from the registry
    terminalService.unregisterTerminalConnection(terminal.id, ws);
    await terminalService.updateTerminalStatus(terminal.id, 'offline');
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`[Terminal WS] Error for terminal ${terminal.id}:`, error);
  });

  // Send welcome message
  sendToTerminal(terminal.id, {
    type: 'config_update',
    payload: {
      heartbeatInterval: 30000,
      connected: true,
    },
  });
}

/**
 * Handle incoming message from terminal
 */
async function handleMessage(
  ws: TerminalSocket,
  message: TerminalMessage
): Promise<void> {
  const terminalId = ws.terminalId;
  if (!terminalId) return;

  switch (message.type) {
    case 'heartbeat':
      ws.isAlive = true;
      terminalService.updateHeartbeat(terminalId);
      // Update database with heartbeat info (keeps terminal "online" and updates device info)
      await terminalService.processHeartbeat(terminalId, message.payload);
      sendToTerminal(terminalId, { type: 'pong' });
      break;

    case 'payment_status':
      await handlePaymentStatus(terminalId, message.payload);
      break;

    case 'error':
      console.error(`[Terminal WS] Terminal ${terminalId} reported error:`, message.payload);
      break;

    default:
      console.warn(`[Terminal WS] Unknown message type from ${terminalId}:`, message);
  }
}

/**
 * Handle payment status update from terminal
 */
async function handlePaymentStatus(
  terminalId: string,
  payload: Record<string, unknown> | undefined
): Promise<void> {
  if (!payload?.paymentId) {
    console.warn('[Terminal WS] Payment status without paymentId');
    return;
  }

  const paymentId = payload.paymentId as string;
  const status = payload.status as string;

  console.log(`[Terminal WS] Payment ${paymentId} status from terminal: ${status}`);

  // Update payment session status
  if (status === 'displayed') {
    // Terminal is showing the QR code - no status change needed
  } else if (status === 'approved') {
    terminalService.updatePaymentStatus(paymentId, 'approved');
  } else if (status === 'declined') {
    terminalService.updatePaymentStatus(paymentId, 'declined');
  } else if (status === 'error') {
    terminalService.updatePaymentStatus(paymentId, 'failed');
  }
}

/**
 * Send message to a specific terminal
 */
export function sendToTerminal(terminalId: string, message: ServerMessage): boolean {
  const connection = terminalService.getTerminalConnection(terminalId);
  if (!connection?.ws) {
    return false;
  }

  try {
    const ws = connection.ws as WebSocket;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
  } catch (error) {
    console.error(`[Terminal WS] Failed to send to terminal ${terminalId}:`, error);
  }

  return false;
}

/**
 * Send payment request to terminal
 */
export function sendPaymentRequest(
  terminalId: string,
  paymentId: string,
  qrCodeUrl: string,
  amount: number,
  currency: string,
  reference?: string,
  expiresAt?: Date
): boolean {
  return sendToTerminal(terminalId, {
    type: 'payment_request',
    payload: {
      paymentId,
      qrCodeUrl,
      amount,
      currency,
      reference,
      expiresAt: expiresAt?.toISOString(),
    },
  });
}

/**
 * Send payment cancellation to terminal
 */
export function sendPaymentCancel(terminalId: string, paymentId: string): boolean {
  return sendToTerminal(terminalId, {
    type: 'payment_cancel',
    payload: { paymentId },
  });
}

/**
 * Get connected terminal count
 */
export function getConnectedCount(): number {
  return wss?.clients.size || 0;
}

/**
 * Close all connections (for graceful shutdown)
 */
export function close(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  wss?.clients.forEach((ws) => {
    ws.close(1001, 'Server shutting down');
  });

  wss?.close();
  wss = null;

  console.log('[Terminal WS] WebSocket server closed');
}
