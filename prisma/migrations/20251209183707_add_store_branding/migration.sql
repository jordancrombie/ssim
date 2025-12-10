-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "description" TEXT,
ADD COLUMN     "heroImageUrl" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "themePreset" TEXT NOT NULL DEFAULT 'default';
