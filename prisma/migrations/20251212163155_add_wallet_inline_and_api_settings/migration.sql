-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "walletApiEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "walletInlineEnabled" BOOLEAN NOT NULL DEFAULT true;
