ALTER TABLE "coach_onboarding_invite" ADD COLUMN "code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_onboarding_invite" ADD CONSTRAINT "coach_onboarding_invite_code_key" UNIQUE("code");