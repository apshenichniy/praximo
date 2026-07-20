CREATE TYPE "cancel_reason" AS ENUM('coach_cancelled', 'no_show', 'room_unavailable');--> statement-breakpoint
CREATE TYPE "close_reason" AS ENUM('coach_end', 'empty_room_idle', 'grace_due', 'room_cap', 'next_session_start');--> statement-breakpoint
CREATE TYPE "invite_status" AS ENUM('pending', 'accepted', 'expired');--> statement-breakpoint
CREATE TYPE "language" AS ENUM('en', 'uk', 'ru');--> statement-breakpoint
CREATE TYPE "no_show_detail" AS ENUM('both_absent', 'coach_absent', 'client_absent', 'no_overlap');--> statement-breakpoint
CREATE TYPE "session_state" AS ENUM('scheduled', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "track_participant" AS ENUM('coach', 'client');--> statement-breakpoint
CREATE TABLE "admin" (
	"id" text PRIMARY KEY,
	"telegram_id" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generation_status" text DEFAULT 'pending' NOT NULL,
	"model" text,
	"prompt_metadata" jsonb,
	"r2_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot" (
	"workspace_id" text PRIMARY KEY,
	"token" text,
	"username" text,
	"connection_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"kind" text NOT NULL,
	"address" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"telegram_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"language" "language",
	"avatar_r2_key" text,
	"google_sub" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_grant" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"scope" text DEFAULT 'recording_and_processing' NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"text_version" text NOT NULL,
	"channel_kind" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"token" text NOT NULL UNIQUE,
	"status" "invite_status" DEFAULT 'pending'::"invite_status" NOT NULL,
	"delivery" jsonb NOT NULL,
	"expected_telegram_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "join_link" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"role" "track_participant" NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"language" "language" NOT NULL,
	"telegram_user_id" text,
	"avatar_r2_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL UNIQUE,
	"egress_metadata" jsonb,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"transcript_generated_at" timestamp with time zone,
	"audio_deleted_by_retention" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"kind" text DEFAULT 'intake' NOT NULL,
	"state" "session_state" DEFAULT 'scheduled'::"session_state" NOT NULL,
	"close_reason" "close_reason",
	"cancel_reason" "cancel_reason",
	"no_show_detail" "no_show_detail",
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track" (
	"id" text PRIMARY KEY,
	"recording_id" text NOT NULL,
	"participant" "track_participant" NOT NULL,
	"duration_seconds" integer,
	"segments" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_transcript" (
	"id" text PRIMARY KEY,
	"track_id" text NOT NULL UNIQUE,
	"provider" text DEFAULT 'deepgram' NOT NULL,
	"provider_metadata" jsonb,
	"r2_key" text,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL UNIQUE,
	"detected_language" text,
	"r2_key" text,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "artifact_session_id_idx" ON "artifact" ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_session_kind_version_idx" ON "artifact" ("session_id","kind","version");--> statement-breakpoint
CREATE INDEX "channel_client_id_idx" ON "channel" ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_one_primary_per_client_idx" ON "channel" ("client_id") WHERE "is_primary";--> statement-breakpoint
CREATE INDEX "client_workspace_id_idx" ON "client" ("workspace_id");--> statement-breakpoint
CREATE INDEX "consent_grant_client_id_idx" ON "consent_grant" ("client_id");--> statement-breakpoint
CREATE INDEX "invite_workspace_id_idx" ON "invite" ("workspace_id");--> statement-breakpoint
CREATE INDEX "invite_client_id_idx" ON "invite" ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "join_link_session_role_idx" ON "join_link" ("session_id","role");--> statement-breakpoint
CREATE INDEX "member_workspace_id_idx" ON "member" ("workspace_id");--> statement-breakpoint
CREATE INDEX "session_workspace_id_idx" ON "session" ("workspace_id");--> statement-breakpoint
CREATE INDEX "session_client_id_idx" ON "session" ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "track_recording_participant_idx" ON "track" ("recording_id","participant");--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bot" ADD CONSTRAINT "bot_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "consent_grant" ADD CONSTRAINT "consent_grant_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "join_link" ADD CONSTRAINT "join_link_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "track" ADD CONSTRAINT "track_recording_id_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recording"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "track_transcript" ADD CONSTRAINT "track_transcript_track_id_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;