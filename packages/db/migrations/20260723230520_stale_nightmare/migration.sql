CREATE TABLE "object_cleanup_job" (
	"id" text PRIMARY KEY,
	"object_key" text NOT NULL UNIQUE,
	"reason" text NOT NULL,
	"correlation_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_deletion_operation" (
	"request_id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"pipeline_status" text DEFAULT 'pending' NOT NULL,
	"farewell_status" text DEFAULT 'pending' NOT NULL,
	"bot_release_status" text DEFAULT 'pending' NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "object_cleanup_job_available_idx" ON "object_cleanup_job" ("status","available_at");--> statement-breakpoint
CREATE INDEX "object_cleanup_job_lease_idx" ON "object_cleanup_job" ("lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_deletion_operation_one_prepared_per_workspace_idx" ON "workspace_deletion_operation" ("workspace_id") WHERE "state" = 'prepared';--> statement-breakpoint
CREATE INDEX "workspace_deletion_operation_expires_at_idx" ON "workspace_deletion_operation" ("expires_at");