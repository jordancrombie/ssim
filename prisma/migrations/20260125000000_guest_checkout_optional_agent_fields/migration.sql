-- Make agentId and ownerId optional for guest checkout (Gateway v1.4.0)
-- Guest sessions start with null values, populated at Device Authorization time

-- AlterTable
ALTER TABLE "agent_sessions" ALTER COLUMN "agentId" DROP NOT NULL;
ALTER TABLE "agent_sessions" ALTER COLUMN "ownerId" DROP NOT NULL;
