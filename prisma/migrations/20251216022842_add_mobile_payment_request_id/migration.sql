-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "mobilePaymentRequestId" TEXT;

-- CreateIndex
CREATE INDEX "orders_mobilePaymentRequestId_idx" ON "orders"("mobilePaymentRequestId");
