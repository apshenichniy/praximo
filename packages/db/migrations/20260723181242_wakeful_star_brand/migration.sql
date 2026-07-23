CREATE TYPE "coach_onboarding_invite_status" AS ENUM('pending', 'used', 'expired');--> statement-breakpoint
CREATE TABLE "coach_onboarding_invite" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"request_id" text NOT NULL UNIQUE,
	"request_fingerprint" text NOT NULL,
	"status" "coach_onboarding_invite_status" DEFAULT 'pending'::"coach_onboarding_invite_status" NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "avatar_r2_key" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "short_description" text;--> statement-breakpoint
CREATE INDEX "coach_onboarding_invite_workspace_id_idx" ON "coach_onboarding_invite" ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_onboarding_invite_one_pending_per_workspace_idx" ON "coach_onboarding_invite" ("workspace_id") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "coach_onboarding_invite" ADD CONSTRAINT "coach_onboarding_invite_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;