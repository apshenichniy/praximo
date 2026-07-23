UPDATE "bot"
SET "connection_status" = 'awaiting_setup'
WHERE "connection_status" = 'pending';--> statement-breakpoint
ALTER TABLE "bot" ALTER COLUMN "connection_status" SET DEFAULT 'awaiting_setup';
