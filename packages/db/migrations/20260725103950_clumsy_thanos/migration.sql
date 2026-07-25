DROP INDEX "coach_bot_notification_workspace_id_idx";--> statement-breakpoint
ALTER TABLE "coach_bot_notification" ADD COLUMN "kind" text DEFAULT 'bot_connected' NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_bot_notification" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
UPDATE "coach_bot_notification" SET "dedupe_key" = 'bot_connected:' || "workspace_id" WHERE "dedupe_key" is null;--> statement-breakpoint
ALTER TABLE "coach_bot_notification" ALTER COLUMN "dedupe_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "credentials_valid_from" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_bot_notification_dedupe_key_idx" ON "coach_bot_notification" ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "member_owner_telegram_user_id_idx" ON "member" ("telegram_user_id") WHERE "role" = 'owner' and "telegram_user_id" is not null;
