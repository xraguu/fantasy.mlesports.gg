-- FAAB in trades: how many FAAB dollars each side of a trade sends to the
-- other (FAAB waiver leagues only). Both default to 0, so existing trades
-- and code are unaffected.

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN "proposerFaab" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "receiverFaab" INTEGER NOT NULL DEFAULT 0;
