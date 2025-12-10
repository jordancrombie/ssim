/**
 * File Upload Service
 *
 * Handles logo and hero image uploads for store branding.
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Upload directory relative to src/public
const UPLOAD_BASE = path.join(__dirname, '../public/uploads');

// Ensure upload directories exist
const uploadDirs = ['logos', 'heroes'];
uploadDirs.forEach((dir) => {
  const fullPath = path.join(UPLOAD_BASE, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

/**
 * Multer storage configuration
 */
const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    const type = file.fieldname === 'logo' ? 'logos' : 'heroes';
    cb(null, path.join(UPLOAD_BASE, type));
  },
  filename: (req, file, cb) => {
    // Use storeId and timestamp to ensure uniqueness
    const storeId = (req as any).storeId || 'default';
    const ext = path.extname(file.originalname).toLowerCase();
    const timestamp = Date.now();
    cb(null, `${storeId}-${timestamp}${ext}`);
  },
});

/**
 * File filter - only allow images
 */
const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
  }
};

/**
 * Multer upload middleware
 */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});

/**
 * Get the public URL for an uploaded file
 */
export function getUploadUrl(filename: string, type: 'logos' | 'heroes'): string {
  return `/uploads/${type}/${filename}`;
}

/**
 * Delete an uploaded file
 */
export function deleteUploadedFile(filepath: string): void {
  // Extract just the path portion after /uploads/
  const relativePath = filepath.replace(/^\/uploads\//, '');
  const fullPath = path.join(UPLOAD_BASE, relativePath);

  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log(`[Upload] Deleted file: ${filepath}`);
    } catch (err) {
      console.error(`[Upload] Failed to delete file: ${filepath}`, err);
    }
  }
}
