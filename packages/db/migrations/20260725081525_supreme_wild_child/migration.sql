ALTER TABLE "coach_bot_provisioning" ADD COLUMN "candidate_bot_id" text;--> statement-breakpoint
ALTER TABLE "coach_bot_provisioning" ADD COLUMN "candidate_bot_username" text;--> statement-breakpoint
ALTER TABLE "coach_bot_provisioning" ADD COLUMN "candidate_token" text;--> statement-breakpoint
ALTER TABLE "coach_bot_provisioning" ADD COLUMN "candidate_proof_hash" text;--> statement-breakpoint
ALTER TABLE "coach_bot_provisioning" ADD COLUMN "candidate_webhook_secret_hash" text;--> statement-breakpoint
ALTER TABLE "coach_bot_provisioning" ADD COLUMN "candidate_ingested_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_bot_provisioning_one_candidate_idx" ON "coach_bot_provisioning" ("candidate_bot_id") WHERE "candidate_bot_id" is not null and "status" <> 'completed';