CREATE TYPE "coach_onboarding_invite_cancellation_reason" AS ENUM('declined_by_coach', 'reset_by_admin', 'reissued');--> statement-breakpoint
ALTER TYPE "coach_onboarding_invite_status" ADD VALUE 'accepted' BEFORE 'used';--> statement-breakpoint
ALTER TYPE "coach_onboarding_invite_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "coach_onboarding_invite" ADD COLUMN "accepted_by_telegram_id" text;--> statement-breakpoint
ALTER TABLE "coach_onboarding_invite" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coach_onboarding_invite" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coach_onboarding_invite" ADD COLUMN "cancellation_reason" "coach_onboarding_invite_cancellation_reason";