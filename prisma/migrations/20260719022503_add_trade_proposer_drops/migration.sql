-- AlterTable
ALTER TABLE "Trade" ADD COLUMN "proposerDrops" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
