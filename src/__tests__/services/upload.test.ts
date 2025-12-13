import { getUploadUrl, deleteUploadedFile } from '../../services/upload';
import fs from 'fs';
import path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

describe('Upload Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUploadUrl', () => {
    it('should return correct URL for logo', () => {
      const result = getUploadUrl('store-123-1234567890.png', 'logos');
      expect(result).toBe('/uploads/logos/store-123-1234567890.png');
    });

    it('should return correct URL for hero image', () => {
      const result = getUploadUrl('store-456-1234567890.jpg', 'heroes');
      expect(result).toBe('/uploads/heroes/store-456-1234567890.jpg');
    });

    it('should handle filenames with special characters', () => {
      const result = getUploadUrl('store-123-test.file.png', 'logos');
      expect(result).toBe('/uploads/logos/store-123-test.file.png');
    });
  });

  describe('deleteUploadedFile', () => {
    it('should delete file when it exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      deleteUploadedFile('/uploads/logos/store-123.png');

      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should not attempt to delete when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      deleteUploadedFile('/uploads/logos/nonexistent.png');

      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should handle errors during deletion gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw
      expect(() => deleteUploadedFile('/uploads/logos/store-123.png')).not.toThrow();
    });

    it('should strip /uploads/ prefix from path', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      deleteUploadedFile('/uploads/heroes/hero-123.jpg');

      // Check that the path passed to existsSync contains 'heroes/hero-123.jpg'
      const existsCall = (fs.existsSync as jest.Mock).mock.calls[0][0];
      expect(existsCall).toContain('heroes');
      expect(existsCall).toContain('hero-123.jpg');
    });
  });
});
