-- CreateTable
CREATE TABLE "terminals" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "deviceModel" TEXT,
    "firmwareVersion" TEXT,
    "macAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "lastSeenAt" TIMESTAMP(3),
    "lastIpAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_pairing_codes" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "terminalId" TEXT,
    "terminalName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "terminals_apiKey_key" ON "terminals"("apiKey");

-- CreateIndex
CREATE INDEX "terminals_storeId_idx" ON "terminals"("storeId");

-- CreateIndex
CREATE INDEX "terminals_apiKey_idx" ON "terminals"("apiKey");

-- CreateIndex
CREATE INDEX "terminals_storeId_status_idx" ON "terminals"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_pairing_codes_code_key" ON "terminal_pairing_codes"("code");

-- CreateIndex
CREATE INDEX "terminal_pairing_codes_code_idx" ON "terminal_pairing_codes"("code");

-- CreateIndex
CREATE INDEX "terminal_pairing_codes_storeId_idx" ON "terminal_pairing_codes"("storeId");

-- AddForeignKey
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
