ALTER TABLE "member" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "settings" jsonb DEFAULT '{}' NOT NULL;