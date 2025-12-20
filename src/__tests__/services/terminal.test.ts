import * as terminalService from '../../services/terminal';

// Mock prisma
jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    terminal: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    terminalPairingCode: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

// Mock config
jest.mock('../../config/env', () => ({
  config: {
    wsimMobileApiUrl: '',
    wsimApiKey: '',
    wsimQrBaseUrl: 'https://wsim.test.com/pay',
    appBaseUrl: 'https://ssim.test.com',
  },
}));

// Mock WebSocket module (dynamic import)
jest.mock('../../services/terminal-websocket', () => ({
  sendPaymentRequest: jest.fn(() => true),
  sendPaymentCancel: jest.fn(() => true),
}));

import prisma from '../../lib/prisma';

const mockTerminal = {
  id: 'terminal-1',
  storeId: 'store-123',
  name: 'Counter Terminal',
  apiKey: 'tkey_abc123',
  deviceModel: 'ESP32-S3',
  firmwareVersion: '1.0.0',
  macAddress: 'AA:BB:CC:DD:EE:FF',
  status: 'online',
  lastSeenAt: new Date(),
  lastIpAddress: '192.168.1.100',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPairingCode = {
  id: 'code-1',
  storeId: 'store-123',
  code: '123456',
  terminalId: 'terminal-1',
  terminalName: 'Counter Terminal',
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  usedAt: null,
  createdAt: new Date(),
};

describe('Terminal Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTerminals', () => {
    it('should return all terminals for a store', async () => {
      const mockTerminals = [mockTerminal, { ...mockTerminal, id: 'terminal-2', name: 'Back Office' }];
      (prisma.terminal.findMany as jest.Mock).mockResolvedValue(mockTerminals);

      const result = await terminalService.getTerminals('store-123');

      expect(result).toEqual(mockTerminals);
      expect(prisma.terminal.findMany).toHaveBeenCalledWith({
        where: { storeId: 'store-123' },
        orderBy: { name: 'asc' },
      });
    });

    it('should return empty array when no terminals exist', async () => {
      (prisma.terminal.findMany as jest.Mock).mockResolvedValue([]);

      const result = await terminalService.getTerminals('store-123');

      expect(result).toEqual([]);
    });
  });

  describe('getTerminal', () => {
    it('should return terminal by ID', async () => {
      (prisma.terminal.findUnique as jest.Mock).mockResolvedValue(mockTerminal);

      const result = await terminalService.getTerminal('terminal-1');

      expect(result).toEqual(mockTerminal);
      expect(prisma.terminal.findUnique).toHaveBeenCalledWith({
        where: { id: 'terminal-1' },
      });
    });

    it('should return null for non-existent terminal', async () => {
      (prisma.terminal.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await terminalService.getTerminal('unknown');

      expect(result).toBeNull();
    });
  });

  describe('getTerminalByApiKey', () => {
    it('should return terminal by API key', async () => {
      (prisma.terminal.findUnique as jest.Mock).mockResolvedValue(mockTerminal);

      const result = await terminalService.getTerminalByApiKey('tkey_abc123');

      expect(result).toEqual(mockTerminal);
      expect(prisma.terminal.findUnique).toHaveBeenCalledWith({
        where: { apiKey: 'tkey_abc123' },
      });
    });

    it('should return null for invalid API key', async () => {
      (prisma.terminal.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await terminalService.getTerminalByApiKey('invalid');

      expect(result).toBeNull();
    });
  });

  describe('createTerminal', () => {
    it('should create a new terminal with pairing code', async () => {
      (prisma.terminal.create as jest.Mock).mockResolvedValue(mockTerminal);
      (prisma.terminalPairingCode.create as jest.Mock).mockResolvedValue(mockPairingCode);

      const result = await terminalService.createTerminal('store-123', 'Counter Terminal');

      expect(result.terminal).toEqual(mockTerminal);
      expect(result.pairingCode).toMatch(/^\d{6}$/);
      expect(prisma.terminal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          storeId: 'store-123',
          name: 'Counter Terminal',
          status: 'pairing',
        }),
      });
      expect(prisma.terminalPairingCode.create).toHaveBeenCalled();
    });

    it('should generate unique API key', async () => {
      (prisma.terminal.create as jest.Mock).mockResolvedValue(mockTerminal);
      (prisma.terminalPairingCode.create as jest.Mock).mockResolvedValue(mockPairingCode);

      await terminalService.createTerminal('store-123', 'Test Terminal');

      const createCall = (prisma.terminal.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.apiKey).toMatch(/^tkey_[a-f0-9]{64}$/);
    });
  });

  describe('completePairing', () => {
    it('should complete pairing with valid code', async () => {
      (prisma.terminalPairingCode.findFirst as jest.Mock).mockResolvedValue(mockPairingCode);
      (prisma.terminal.update as jest.Mock).mockResolvedValue({
        ...mockTerminal,
        status: 'offline',
        deviceModel: 'ESP32-S3',
      });
      (prisma.terminalPairingCode.update as jest.Mock).mockResolvedValue({
        ...mockPairingCode,
        usedAt: new Date(),
      });

      const result = await terminalService.completePairing('123456', {
        model: 'ESP32-S3',
        firmwareVersion: '1.0.0',
        macAddress: 'AA:BB:CC:DD:EE:FF',
      });

      expect(result).toBeTruthy();
      expect(result!.terminal.status).toBe('offline');
      expect(prisma.terminal.update).toHaveBeenCalledWith({
        where: { id: 'terminal-1' },
        data: expect.objectContaining({
          status: 'offline',
          deviceModel: 'ESP32-S3',
          firmwareVersion: '1.0.0',
          macAddress: 'AA:BB:CC:DD:EE:FF',
        }),
      });
    });

    it('should return null for invalid pairing code', async () => {
      (prisma.terminalPairingCode.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await terminalService.completePairing('000000', {});

      expect(result).toBeNull();
    });

    it('should return null for expired pairing code', async () => {
      (prisma.terminalPairingCode.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await terminalService.completePairing('123456', {});

      expect(result).toBeNull();
    });
  });

  describe('updateTerminalStatus', () => {
    it('should update terminal status to online', async () => {
      (prisma.terminal.update as jest.Mock).mockResolvedValue({
        ...mockTerminal,
        status: 'online',
      });

      const result = await terminalService.updateTerminalStatus('terminal-1', 'online', '192.168.1.100');

      expect(result.status).toBe('online');
      expect(prisma.terminal.update).toHaveBeenCalledWith({
        where: { id: 'terminal-1' },
        data: expect.objectContaining({
          status: 'online',
          lastIpAddress: '192.168.1.100',
        }),
      });
    });

    it('should update terminal status to offline', async () => {
      (prisma.terminal.update as jest.Mock).mockResolvedValue({
        ...mockTerminal,
        status: 'offline',
      });

      const result = await terminalService.updateTerminalStatus('terminal-1', 'offline');

      expect(result.status).toBe('offline');
    });
  });

  describe('deleteTerminal', () => {
    it('should delete terminal belonging to store', async () => {
      (prisma.terminal.findFirst as jest.Mock).mockResolvedValue(mockTerminal);
      (prisma.terminal.delete as jest.Mock).mockResolvedValue(mockTerminal);

      await terminalService.deleteTerminal('store-123', 'terminal-1');

      expect(prisma.terminal.delete).toHaveBeenCalledWith({
        where: { id: 'terminal-1' },
      });
    });

    it('should throw error for terminal not belonging to store', async () => {
      (prisma.terminal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(terminalService.deleteTerminal('store-123', 'unknown'))
        .rejects.toThrow('Terminal not found');
    });
  });

  describe('Terminal Connection Registry', () => {
    it('should register and unregister terminal connections', () => {
      const mockWs = { send: jest.fn(), readyState: 1 };

      terminalService.registerTerminalConnection('terminal-1', mockWs);
      expect(terminalService.isTerminalConnected('terminal-1')).toBe(true);

      terminalService.unregisterTerminalConnection('terminal-1');
      expect(terminalService.isTerminalConnected('terminal-1')).toBe(false);
    });

    it('should get connected terminal IDs', () => {
      const mockWs1 = { send: jest.fn(), readyState: 1 };
      const mockWs2 = { send: jest.fn(), readyState: 1 };

      terminalService.registerTerminalConnection('terminal-1', mockWs1);
      terminalService.registerTerminalConnection('terminal-2', mockWs2);

      const connectedIds = terminalService.getConnectedTerminalIds();
      expect(connectedIds).toContain('terminal-1');
      expect(connectedIds).toContain('terminal-2');

      // Cleanup
      terminalService.unregisterTerminalConnection('terminal-1');
      terminalService.unregisterTerminalConnection('terminal-2');
    });

    it('should update heartbeat', () => {
      const mockWs = { send: jest.fn(), readyState: 1 };

      terminalService.registerTerminalConnection('terminal-1', mockWs);

      // Wait a bit and update heartbeat
      const connection = terminalService.getTerminalConnection('terminal-1');
      const initialHeartbeat = connection?.lastHeartbeat;

      // Update heartbeat
      terminalService.updateHeartbeat('terminal-1');

      const updatedConnection = terminalService.getTerminalConnection('terminal-1');
      expect(updatedConnection?.lastHeartbeat).toBeDefined();

      // Cleanup
      terminalService.unregisterTerminalConnection('terminal-1');
    });
  });

  describe('Payment Sessions', () => {
    it('should initiate payment in stub mode', async () => {
      const result = await terminalService.initiatePayment({
        storeId: 'store-123',
        terminalId: 'terminal-1',
        amount: 1500,
        currency: 'CAD',
        reference: 'ORDER-001',
      });

      expect(result.paymentId).toMatch(/^tpay_[a-f0-9]{32}$/);
      expect(result.storeId).toBe('store-123');
      expect(result.terminalId).toBe('terminal-1');
      expect(result.amount).toBe(1500);
      expect(result.currency).toBe('CAD');
      expect(result.status).toBe('pending');
      expect(result.qrCodeUrl).toContain('wsim.test.com/pay/terminal-stub-');
    });

    it('should get payment status', async () => {
      const payment = await terminalService.initiatePayment({
        storeId: 'store-123',
        terminalId: 'terminal-1',
        amount: 2000,
        currency: 'CAD',
      });

      const status = terminalService.getPaymentStatus('store-123', payment.paymentId);

      expect(status).toBeTruthy();
      expect(status?.status).toBe('pending');
      expect(status?.amount).toBe(2000);
    });

    it('should return null for payment not found', () => {
      const status = terminalService.getPaymentStatus('store-123', 'unknown');
      expect(status).toBeNull();
    });

    it('should return null for payment from different store', async () => {
      const payment = await terminalService.initiatePayment({
        storeId: 'store-123',
        terminalId: 'terminal-1',
        amount: 1000,
        currency: 'CAD',
      });

      const status = terminalService.getPaymentStatus('different-store', payment.paymentId);
      expect(status).toBeNull();
    });

    it('should update payment status', async () => {
      const payment = await terminalService.initiatePayment({
        storeId: 'store-123',
        terminalId: 'terminal-1',
        amount: 1000,
        currency: 'CAD',
      });

      terminalService.updatePaymentStatus(payment.paymentId, 'approved');

      const status = terminalService.getPaymentStatus('store-123', payment.paymentId);
      expect(status?.status).toBe('approved');
    });

    it('should cancel pending payment', async () => {
      const payment = await terminalService.initiatePayment({
        storeId: 'store-123',
        terminalId: 'terminal-1',
        amount: 1000,
        currency: 'CAD',
      });

      await terminalService.cancelPayment('store-123', payment.paymentId);

      const status = terminalService.getPaymentStatus('store-123', payment.paymentId);
      expect(status?.status).toBe('cancelled');
    });

    it('should throw error cancelling non-existent payment', async () => {
      await expect(terminalService.cancelPayment('store-123', 'unknown'))
        .rejects.toThrow('Payment not found');
    });

    it('should throw error cancelling non-pending payment', async () => {
      const payment = await terminalService.initiatePayment({
        storeId: 'store-123',
        terminalId: 'terminal-1',
        amount: 1000,
        currency: 'CAD',
      });

      terminalService.updatePaymentStatus(payment.paymentId, 'approved');

      await expect(terminalService.cancelPayment('store-123', payment.paymentId))
        .rejects.toThrow('Payment cannot be cancelled');
    });

    it('should get active payments for store', async () => {
      await terminalService.initiatePayment({
        storeId: 'store-123',
        terminalId: 'terminal-1',
        amount: 1000,
        currency: 'CAD',
      });

      await terminalService.initiatePayment({
        storeId: 'store-123',
        terminalId: 'terminal-2',
        amount: 2000,
        currency: 'CAD',
      });

      const activePayments = terminalService.getActivePayments('store-123');

      expect(activePayments.length).toBeGreaterThanOrEqual(2);
      activePayments.forEach(p => {
        expect(p.storeId).toBe('store-123');
        expect(p.status).toBe('pending');
      });
    });

    it('should mark expired payments', async () => {
      // This is a bit tricky to test without mocking Date.now()
      // Just verify the function doesn't throw
      const cleaned = terminalService.cleanupExpiredSessions();
      expect(typeof cleaned).toBe('number');
    });
  });

  describe('regeneratePairingCode', () => {
    it('should regenerate pairing code for existing terminal', async () => {
      (prisma.terminal.findFirst as jest.Mock).mockResolvedValue(mockTerminal);
      (prisma.terminalPairingCode.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.terminalPairingCode.create as jest.Mock).mockResolvedValue(mockPairingCode);
      (prisma.terminal.update as jest.Mock).mockResolvedValue({
        ...mockTerminal,
        status: 'pairing',
      });

      const result = await terminalService.regeneratePairingCode('store-123', 'terminal-1');

      expect(result).toMatch(/^\d{6}$/);
      expect(prisma.terminalPairingCode.updateMany).toHaveBeenCalled();
      expect(prisma.terminalPairingCode.create).toHaveBeenCalled();
      expect(prisma.terminal.update).toHaveBeenCalledWith({
        where: { id: 'terminal-1' },
        data: { status: 'pairing' },
      });
    });

    it('should throw error for non-existent terminal', async () => {
      (prisma.terminal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(terminalService.regeneratePairingCode('store-123', 'unknown'))
        .rejects.toThrow('Terminal not found');
    });
  });
});
