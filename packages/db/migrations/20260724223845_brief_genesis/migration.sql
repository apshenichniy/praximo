ALTER TABLE "workspace_deletion_operation" ADD COLUMN "driver_id" text;--> statement-breakpoint
ALTER TABLE "workspace_deletion_operation" ADD COLUMN "lease_until" timestamp with time zone;