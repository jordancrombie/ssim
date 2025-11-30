// Jest test setup file

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3005';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.APP_BASE_URL = 'http://localhost:3005';

// Increase test timeout for async operations
jest.setTimeout(10000);

// Suppress console output during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   error: jest.fn(),
//   warn: jest.fn(),
// };
