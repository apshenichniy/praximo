ALTER TABLE "bot" ADD COLUMN "health_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot" ADD COLUMN "relink_episode" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_bot_notification" ADD COLUMN "recipient_role" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
CREATE INDEX "bot_health_check_idx" ON "bot" ("connection_status","health_checked_at");