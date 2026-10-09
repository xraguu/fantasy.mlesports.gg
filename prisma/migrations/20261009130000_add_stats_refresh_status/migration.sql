-- When the last stats refresh ran, whether it worked, and a short summary
-- (or its error), for the admin Database page. All nullable, so code that
-- doesn't know about them yet keeps working.
ALTER TABLE "AppSettings" ADD COLUMN "statsRefreshedAt" TIMESTAMP(3);
ALTER TABLE "AppSettings" ADD COLUMN "statsRefreshOk" BOOLEAN;
ALTER TABLE "AppSettings" ADD COLUMN "statsRefreshNote" TEXT;
