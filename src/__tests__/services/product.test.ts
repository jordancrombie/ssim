// Mock the Prisma client - must be before imports
const mockPrismaProduct = {
  count: jest.fn(),
  createMany: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    product: mockPrismaProduct,
  },
}));

import * as productService from '../../services/product';

describe('Product Service', () => {
  const storeId = 'store-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('formatPrice', () => {
    it('should format price in CAD by default', () => {
      expect(productService.formatPrice(1000)).toBe('$10.00');
      expect(productService.formatPrice(1050)).toBe('$10.50');
      expect(productService.formatPrice(99)).toBe('$0.99');
    });

    it('should handle zero', () => {
      expect(productService.formatPrice(0)).toBe('$0.00');
    });

    it('should format with specified currency', () => {
      const result = productService.formatPrice(1000, 'USD');
      expect(result).toContain('10.00');
    });

    it('should handle large amounts', () => {
      expect(productService.formatPrice(100000)).toBe('$1,000.00');
      expect(productService.formatPrice(1000000)).toBe('$10,000.00');
    });
  });

  describe('seedDefaultProducts', () => {
    it('should seed products when store has none', async () => {
      mockPrismaProduct.count.mockResolvedValue(0);
      mockPrismaProduct.createMany.mockResolvedValue({ count: 6 });

      await productService.seedDefaultProducts(storeId);

      expect(mockPrismaProduct.count).toHaveBeenCalledWith({ where: { storeId } });
      expect(mockPrismaProduct.createMany).toHaveBeenCalled();

      // Check that products were created with correct store and currency
      const createCall = mockPrismaProduct.createMany.mock.calls[0][0];
      expect(createCall.data.length).toBe(6);
      expect(createCall.data[0].storeId).toBe(storeId);
      expect(createCall.data[0].currency).toBe('CAD');
    });

    it('should not seed products when store already has products', async () => {
      mockPrismaProduct.count.mockResolvedValue(5);

      await productService.seedDefaultProducts(storeId);

      expect(mockPrismaProduct.count).toHaveBeenCalledWith({ where: { storeId } });
      expect(mockPrismaProduct.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getProductById', () => {
    it('should return product when found', async () => {
      const mockProduct = { id: 'prod-1', storeId, name: 'Test Product', price: 1000 };
      mockPrismaProduct.findFirst.mockResolvedValue(mockProduct);

      const result = await productService.getProductById(storeId, 'prod-1');

      expect(result).toEqual(mockProduct);
      expect(mockPrismaProduct.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-1', storeId },
      });
    });

    it('should return null when product not found', async () => {
      mockPrismaProduct.findFirst.mockResolvedValue(null);

      const result = await productService.getProductById(storeId, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getAllProducts', () => {
    it('should return only active products by default', async () => {
      const mockProducts = [
        { id: 'prod-1', name: 'Product 1', isActive: true },
        { id: 'prod-2', name: 'Product 2', isActive: true },
      ];
      mockPrismaProduct.findMany.mockResolvedValue(mockProducts);

      const result = await productService.getAllProducts(storeId);

      expect(result).toEqual(mockProducts);
      expect(mockPrismaProduct.findMany).toHaveBeenCalledWith({
        where: { storeId, isActive: true },
        orderBy: { name: 'asc' },
      });
    });

    it('should include inactive products when requested', async () => {
      const mockProducts = [
        { id: 'prod-1', name: 'Product 1', isActive: true },
        { id: 'prod-2', name: 'Product 2', isActive: false },
      ];
      mockPrismaProduct.findMany.mockResolvedValue(mockProducts);

      const result = await productService.getAllProducts(storeId, true);

      expect(result).toEqual(mockProducts);
      expect(mockPrismaProduct.findMany).toHaveBeenCalledWith({
        where: { storeId },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('getProductsByCategory', () => {
    it('should return products in specified category', async () => {
      const mockProducts = [
        { id: 'prod-1', name: 'Product 1', category: 'Electronics' },
      ];
      mockPrismaProduct.findMany.mockResolvedValue(mockProducts);

      const result = await productService.getProductsByCategory(storeId, 'Electronics');

      expect(result).toEqual(mockProducts);
      expect(mockPrismaProduct.findMany).toHaveBeenCalledWith({
        where: { storeId, category: 'Electronics', isActive: true },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('getCategories', () => {
    it('should return unique categories', async () => {
      const mockResults = [
        { category: 'Electronics' },
        { category: 'Home' },
        { category: 'Sports' },
      ];
      mockPrismaProduct.findMany.mockResolvedValue(mockResults);

      const result = await productService.getCategories(storeId);

      expect(result).toEqual(['Electronics', 'Home', 'Sports']);
      expect(mockPrismaProduct.findMany).toHaveBeenCalledWith({
        where: { storeId, isActive: true },
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      });
    });
  });

  describe('createProduct', () => {
    it('should create a product with required fields', async () => {
      const params = {
        name: 'New Product',
        description: 'A great product',
        price: 2999,
        category: 'Electronics',
      };

      const mockCreated = { id: 'new-prod', storeId, ...params, currency: 'CAD', isActive: true };
      mockPrismaProduct.create.mockResolvedValue(mockCreated);

      const result = await productService.createProduct(storeId, params);

      expect(result).toEqual(mockCreated);
      expect(mockPrismaProduct.create).toHaveBeenCalledWith({
        data: {
          storeId,
          name: 'New Product',
          description: 'A great product',
          price: 2999,
          currency: 'CAD',
          image: undefined,
          category: 'Electronics',
          isActive: true,
        },
      });
    });

    it('should create a product with optional fields', async () => {
      const params = {
        name: 'New Product',
        description: 'A great product',
        price: 2999,
        category: 'Electronics',
        currency: 'USD',
        image: '/images/product.jpg',
      };

      const mockCreated = { id: 'new-prod', storeId, ...params, isActive: true };
      mockPrismaProduct.create.mockResolvedValue(mockCreated);

      const result = await productService.createProduct(storeId, params);

      expect(result).toEqual(mockCreated);
      expect(mockPrismaProduct.create).toHaveBeenCalledWith({
        data: {
          storeId,
          name: 'New Product',
          description: 'A great product',
          price: 2999,
          currency: 'USD',
          image: '/images/product.jpg',
          category: 'Electronics',
          isActive: true,
        },
      });
    });
  });

  describe('updateProduct', () => {
    it('should update an existing product', async () => {
      const existing = { id: 'prod-1', storeId, name: 'Old Name', price: 1000 };
      const updated = { ...existing, name: 'New Name', price: 1500 };

      mockPrismaProduct.findFirst.mockResolvedValue(existing);
      mockPrismaProduct.update.mockResolvedValue(updated);

      const result = await productService.updateProduct(storeId, 'prod-1', { name: 'New Name', price: 1500 });

      expect(result).toEqual(updated);
      expect(mockPrismaProduct.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { name: 'New Name', price: 1500 },
      });
    });

    it('should return null when product not found', async () => {
      mockPrismaProduct.findFirst.mockResolvedValue(null);

      const result = await productService.updateProduct(storeId, 'non-existent', { name: 'New Name' });

      expect(result).toBeNull();
      expect(mockPrismaProduct.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteProduct', () => {
    it('should delete an existing product', async () => {
      const existing = { id: 'prod-1', storeId, name: 'Product to Delete' };
      mockPrismaProduct.findFirst.mockResolvedValue(existing);
      mockPrismaProduct.delete.mockResolvedValue(existing);

      const result = await productService.deleteProduct(storeId, 'prod-1');

      expect(result).toBe(true);
      expect(mockPrismaProduct.delete).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
      });
    });

    it('should return false when product not found', async () => {
      mockPrismaProduct.findFirst.mockResolvedValue(null);

      const result = await productService.deleteProduct(storeId, 'non-existent');

      expect(result).toBe(false);
      expect(mockPrismaProduct.delete).not.toHaveBeenCalled();
    });
  });

  describe('toggleProductActive', () => {
    it('should toggle active product to inactive', async () => {
      const existing = { id: 'prod-1', storeId, name: 'Product', isActive: true };
      const toggled = { ...existing, isActive: false };

      mockPrismaProduct.findFirst.mockResolvedValue(existing);
      mockPrismaProduct.update.mockResolvedValue(toggled);

      const result = await productService.toggleProductActive(storeId, 'prod-1');

      expect(result?.isActive).toBe(false);
      expect(mockPrismaProduct.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { isActive: false },
      });
    });

    it('should toggle inactive product to active', async () => {
      const existing = { id: 'prod-1', storeId, name: 'Product', isActive: false };
      const toggled = { ...existing, isActive: true };

      mockPrismaProduct.findFirst.mockResolvedValue(existing);
      mockPrismaProduct.update.mockResolvedValue(toggled);

      const result = await productService.toggleProductActive(storeId, 'prod-1');

      expect(result?.isActive).toBe(true);
      expect(mockPrismaProduct.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { isActive: true },
      });
    });

    it('should return null when product not found', async () => {
      mockPrismaProduct.findFirst.mockResolvedValue(null);

      const result = await productService.toggleProductActive(storeId, 'non-existent');

      expect(result).toBeNull();
      expect(mockPrismaProduct.update).not.toHaveBeenCalled();
    });
  });

  describe('getProductStats', () => {
    it('should return product statistics', async () => {
      mockPrismaProduct.count.mockResolvedValueOnce(10); // total
      mockPrismaProduct.count.mockResolvedValueOnce(8); // active
      mockPrismaProduct.findMany.mockResolvedValue([
        { category: 'Electronics' },
        { category: 'Home' },
        { category: 'Sports' },
      ]);

      const result = await productService.getProductStats(storeId);

      expect(result).toEqual({
        total: 10,
        active: 8,
        categories: 3,
      });
    });

    it('should return zeros for empty store', async () => {
      mockPrismaProduct.count.mockResolvedValueOnce(0); // total
      mockPrismaProduct.count.mockResolvedValueOnce(0); // active
      mockPrismaProduct.findMany.mockResolvedValue([]);

      const result = await productService.getProductStats(storeId);

      expect(result).toEqual({
        total: 0,
        active: 0,
        categories: 0,
      });
    });
  });
});
