-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "bankPaymentEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "walletPopupEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "walletQuickCheckoutEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "walletRedirectEnabled" BOOLEAN NOT NULL DEFAULT true;
