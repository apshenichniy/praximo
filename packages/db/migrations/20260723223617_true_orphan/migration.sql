CREATE TYPE "coach_bot_notification_status" AS ENUM('pending', 'delivered');--> statement-breakpoint
CREATE TYPE "coach_bot_provisioning_status" AS ENUM('requested', 'configuring', 'completed');--> statement-breakpoint
CREATE TABLE "coach_bot_notification" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"recipient_telegram_id" text NOT NULL,
	"status" "coach_bot_notification_status" DEFAULT 'pending'::"coach_bot_notification_status" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_bot_provisioning" (
	"id" text PRIMARY KEY,
	"invite_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"coach_telegram_id" text NOT NULL,
	"keyboard_request_id" integer NOT NULL,
	"managed_bot_id" text,
	"managed_bot_username" text,
	"status" "coach_bot_provisioning_status" DEFAULT 'requested'::"coach_bot_provisioning_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot" ADD COLUMN "telegram_bot_id" text;--> statement-breakpoint
ALTER TABLE "bot" ADD COLUMN "bot_info" jsonb;--> statement-breakpoint
ALTER TABLE "bot" ADD COLUMN "webhook_secret_hash" text;--> statement-breakpoint
ALTER TABLE "coach_onboarding_invite" ADD COLUMN "issued_by_telegram_id" text;--> statement-breakpoint
UPDATE "coach_onboarding_invite"
SET "issued_by_telegram_id" = (
	SELECT "telegram_id"
	FROM "admin"
	ORDER BY "created_at"
	LIMIT 1
)
WHERE "issued_by_telegram_id" IS NULL;--> statement-breakpoint
ALTER TABLE "coach_onboarding_invite" ALTER COLUMN "issued_by_telegram_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bot" ADD CONSTRAINT "bot_telegram_bot_id_key" UNIQUE("telegram_bot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_bot_notification_workspace_id_idx" ON "coach_bot_notification" ("workspace_id");--> statement-breakpoint
CREATE INDEX "coach_bot_notification_delivery_idx" ON "coach_bot_notification" ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_bot_provisioning_coach_request_idx" ON "coach_bot_provisioning" ("coach_telegram_id","keyboard_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_bot_provisioning_one_claim_per_invite_idx" ON "coach_bot_provisioning" ("invite_id") WHERE "status" in ('configuring', 'completed');--> statement-breakpoint
CREATE UNIQUE INDEX "coach_bot_provisioning_one_bot_idx" ON "coach_bot_provisioning" ("managed_bot_id") WHERE "managed_bot_id" is not null;--> statement-breakpoint
CREATE INDEX "coach_bot_provisioning_workspace_id_idx" ON "coach_bot_provisioning" ("workspace_id");--> statement-breakpoint
ALTER TABLE "coach_bot_notification" ADD CONSTRAINT "coach_bot_notification_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "coach_bot_provisioning" ADD CONSTRAINT "coach_bot_provisioning_QphlPRLibWTf_fkey" FOREIGN KEY ("invite_id") REFERENCES "coach_onboarding_invite"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "coach_bot_provisioning" ADD CONSTRAINT "coach_bot_provisioning_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
