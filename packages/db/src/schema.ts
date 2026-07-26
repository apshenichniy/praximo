import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

/**
 * The full Drizzle schema for the MVP domain model (docs/spec/domain-model.md).
 *
 * Tenancy invariant: every row reaches its `workspace_id` directly (workspace,
 * member, client, invite, session) or through its parent chain — channel and
 * consent_grant via client; recording via session; track via recording;
 * track_transcript via track; transcript and artifact via session. The FK
 * columns below *are* that chain.
 *
 * Two dimensions stay separate (no god-status on session): `session.state` is
 * the human-facing lifecycle, while each derived entity (recording, track
 * transcript, transcript, artifact) carries its own `processing_status`. The
 * processing-status *shape* is deliberately a plain text column — its retry
 * semantics are owned by the pipeline ADR (#10), not this schema.
 *
 * Content lives in R2, metadata in Postgres: track transcripts, the combined
 * transcript, and artifact bodies are referenced by `r2_key`, never inlined.
 *
 * Open sets (channel kind, session kind, artifact kind, member role) are `text`
 * on purpose — new kinds must be addable without a migration. Closed, lifecycle-
 * critical sets (session state, close/cancel reasons, invite status, track
 * participant, language) are enums.
 */

// ── Enums (closed sets only) ──

export const languageEnum = pgEnum("language", ["en", "uk", "ru"])

export const sessionStateEnum = pgEnum("session_state", [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
])

export const closeReasonEnum = pgEnum("close_reason", [
  "coach_end",
  "empty_room_idle",
  "grace_due",
  "room_cap",
  "next_session_start",
])

export const cancelReasonEnum = pgEnum("cancel_reason", [
  "coach_cancelled",
  "no_show",
  "room_unavailable",
])

export const noShowDetailEnum = pgEnum("no_show_detail", [
  "both_absent",
  "coach_absent",
  "client_absent",
  "no_overlap",
])

export const inviteStatusEnum = pgEnum("invite_status", ["pending", "accepted", "expired"])

export const coachOnboardingInviteStatusEnum = pgEnum("coach_onboarding_invite_status", [
  "pending",
  "accepted",
  "used",
  "expired",
  "cancelled",
])

export const coachOnboardingInviteCancellationReasonEnum = pgEnum(
  "coach_onboarding_invite_cancellation_reason",
  ["declined_by_coach", "reset_by_admin", "reissued"],
)

export const coachBotProvisioningStatusEnum = pgEnum("coach_bot_provisioning_status", [
  "requested",
  "configuring",
  "completed",
])

export const coachBotNotificationStatusEnum = pgEnum("coach_bot_notification_status", [
  "pending",
  "delivered",
])

export const trackParticipantEnum = pgEnum("track_participant", ["coach", "client"])

// ── Platform level (above tenancy) ──

/**
 * The platform operator, keyed by Telegram id. Deliberately outside the tenancy
 * graph — it has no `workspace_id`. Seeded by db:reset from the root `.env`; the
 * same shape a future assignable admin role reuses (admin-surface.md).
 */
export const admin = pgTable("admin", {
  id: text("id").primaryKey(),
  telegramId: text("telegram_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

// ── Tenancy root ──

export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  avatarR2Key: text("avatar_r2_key"),
  description: text("description"),
  shortDescription: text("short_description"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

/**
 * Operational receipt outside the tenancy cascade. It contains no workspace
 * content or Telegram credentials and exists only to resume/reconcile deletion.
 */
export const workspaceDeletionOperation = pgTable(
  "workspace_deletion_operation",
  {
    requestId: text("request_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    pipelineStatus: text("pipeline_status").notNull().default("pending"),
    farewellStatus: text("farewell_status").notNull().default("pending"),
    botReleaseStatus: text("bot_release_status").notNull().default("pending"),
    state: text("state").notNull().default("prepared"),
    // Single-driver lease. `driver_id` is a token minted per deleteWorkspace
    // invocation, not the client's requestId: that one is reused across retries
    // and shared by a double submit, so it cannot tell two attempts apart.
    driverId: text("driver_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("workspace_deletion_operation_one_prepared_per_workspace_idx")
      .on(t.workspaceId)
      .where(sql`${t.state} = 'prepared'`),
    index("workspace_deletion_operation_expires_at_idx").on(t.expiresAt),
  ],
)

/** Generic durable R2 deletion work, shared with the later retention slice. */
export const objectCleanupJob = pgTable(
  "object_cleanup_job",
  {
    id: text("id").primaryKey(),
    objectKey: text("object_key").notNull().unique(),
    reason: text("reason").notNull(),
    correlationId: text("correlation_id").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("object_cleanup_job_available_idx").on(t.status, t.availableAt),
    index("object_cleanup_job_lease_idx").on(t.leaseUntil),
  ],
)

export const coachOnboardingInvite = pgTable(
  "coach_onboarding_invite",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull().unique(),
    requestFingerprint: text("request_fingerprint").notNull(),
    // The public start-param code (`ws_{code}`). Unique so the bot resolves an
    // invite by a single indexed lookup; a collision on insert retries.
    code: text("code").notNull().unique(),
    issuedByTelegramId: text("issued_by_telegram_id").notNull(),
    // Last delivery of this invite: { channel: telegram|email|copy,
    // destination?, language }. Null until the first delivery action; feeds the
    // pending card ("Invited via …") and Resend's message language.
    delivery: jsonb("delivery"),
    // The language this invitation was written in — the administrator's own
    // statement about the coach they are inviting, and the seed the accepting
    // `/start` prefers over the coach's device locale (#164). Set at creation
    // and moved by a resend in a different language. Null on rows minted before
    // that, which is precisely when the device locale is still the best guess.
    language: languageEnum("language"),
    status: coachOnboardingInviteStatusEnum("status").notNull().default("pending"),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    // The exclusive claim taken by the first valid `/start` (#112). The coach's
    // Telegram identity lands here well before `member.telegram_user_id`, which
    // is only bound once their bot actually connects.
    acceptedByTelegramId: text("accepted_by_telegram_id"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    cancellationReason: coachOnboardingInviteCancellationReasonEnum("cancellation_reason"),
  },
  (t) => [
    index("coach_onboarding_invite_workspace_id_idx").on(t.workspaceId),
    // At most one claimable invite per workspace: an accepted claim occupies the
    // same slot a pending one did, so a reissue must cancel before it inserts.
    // Split from the enum migration on purpose — Postgres refuses to use a value
    // added by `ALTER TYPE ... ADD VALUE` inside the same transaction.
    uniqueIndex("coach_onboarding_invite_one_pending_per_workspace_idx")
      .on(t.workspaceId)
      .where(sql`${t.status} in ('pending', 'accepted')`),
  ],
)

/**
 * The workspace's Telegram bot (1:1). Modeled as a child table keyed by
 * `workspace_id` as its own primary key. Provisioning mechanics arrive with the
 * bot-per-coach ticket (#9); here it is metadata only.
 */
export const bot = pgTable(
  "bot",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // A versioned AES-256-GCM envelope. Plain Telegram credentials never enter
    // Postgres, logs, RPC payloads, or service bindings.
    token: text("token"),
    telegramBotId: text("telegram_bot_id").unique(),
    username: text("username"),
    botInfo: jsonb("bot_info"),
    webhookSecretHash: text("webhook_secret_hash"),
    connectionStatus: text("connection_status").notNull().default("awaiting_setup"),
    // When Telegram last confirmed this bot answers to its stored credential
    // (#55). The health sweep takes its batch from the oldest of these rather
    // than from a second cron, so the pass self-staggers: a bot checked now
    // falls to the back of the queue for a day. Null is "never checked", which
    // sorts first.
    healthCheckedAt: timestamp("health_checked_at", { withTimezone: true, mode: "date" }),
    // How many times this workspace's bot has become unreachable beyond repair.
    // Incremented inside the conditional flip, so the winning statement is what
    // hands out the episode number — which is what keeps two notifications about
    // one outage apart from the next outage's pair (#55).
    relinkEpisode: integer("relink_episode").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // The sweep's whole access pattern: connected bots, oldest check first.
    index("bot_health_check_idx").on(t.connectionStatus, t.healthCheckedAt),
  ],
)

/**
 * A `/start` only creates a request row. The first matching `managed_bot`
 * service update atomically advances one row to `configuring`; the partial
 * unique index keeps the invitation unclaimed until that moment.
 *
 * The `candidate_*` columns carry the BotFather fallback (#95): a token pasted
 * into the manager chat is validated, encrypted, and parked on the same attempt
 * row until the coach proves ownership through the candidate bot. Only then does
 * it advance into `managed_bot_id` and through the one-tap path's own claim,
 * configuration, and activation. The plaintext token never lands here.
 */
export const coachBotProvisioning = pgTable(
  "coach_bot_provisioning",
  {
    id: text("id").primaryKey(),
    inviteId: text("invite_id")
      .notNull()
      .references(() => coachOnboardingInvite.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    coachTelegramId: text("coach_telegram_id").notNull(),
    // Named after the `request_managed_bot` keyboard button that no longer
    // exists (#134): creation is launched by deep link now, and the deep-link
    // form carries no request id. The column stays under its old name because
    // what it actually is — this attempt's stable identity within the coach,
    // derived from (invite, coach) and fenced by the unique index below — never
    // depended on the keyboard. Renaming it would rewrite the index and the
    // fence to say the same thing.
    keyboardRequestId: integer("keyboard_request_id").notNull(),
    // The manager-chat message whose inline button launches creation (#134).
    // Recorded because a link in a message is permanent where the reply-keyboard
    // button it replaces vanished after one tap: this is the only handle on the
    // prompt that has to be disarmed before another is sent, and edited once the
    // bot is connected. Null until the first prompt has been sent.
    promptMessageId: integer("prompt_message_id"),
    managedBotId: text("managed_bot_id"),
    managedBotUsername: text("managed_bot_username"),
    candidateBotId: text("candidate_bot_id"),
    candidateBotUsername: text("candidate_bot_username"),
    // The same versioned AES-256-GCM envelope `bot.token` holds.
    candidateToken: text("candidate_token"),
    // SHA-256 of the proof nonce carried by the candidate bot's `/start` link,
    // and of the webhook secret that bot answers the proof route with. Both are
    // secrets the coach's own bot echoes back, so only their hashes are stored.
    candidateProofHash: text("candidate_proof_hash"),
    candidateWebhookSecretHash: text("candidate_webhook_secret_hash"),
    candidateIngestedAt: timestamp("candidate_ingested_at", {
      withTimezone: true,
      mode: "date",
    }),
    status: coachBotProvisioningStatusEnum("status").notNull().default("requested"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    uniqueIndex("coach_bot_provisioning_coach_request_idx").on(
      t.coachTelegramId,
      t.keyboardRequestId,
    ),
    uniqueIndex("coach_bot_provisioning_one_claim_per_invite_idx")
      .on(t.inviteId)
      .where(sql`${t.status} in ('configuring', 'completed')`),
    uniqueIndex("coach_bot_provisioning_one_bot_idx")
      .on(t.managedBotId)
      .where(sql`${t.managedBotId} is not null`),
    // One in-flight candidate per bot: two coaches cannot park the same pasted
    // bot at once, and the proof webhook resolves its row by bot id alone. A
    // completed attempt drops out so the bot can be onboarded again later.
    uniqueIndex("coach_bot_provisioning_one_candidate_idx")
      .on(t.candidateBotId)
      .where(sql`${t.candidateBotId} is not null and ${t.status} <> 'completed'`),
    index("coach_bot_provisioning_workspace_id_idx").on(t.workspaceId),
  ],
)

/**
 * Admin-facing pushes committed together with the workspace fact that caused
 * them. Delivery is retried independently so a Telegram outage cannot roll back
 * a connected bot.
 *
 * Idempotency is keyed on `dedupe_key`, composed by the caller, rather than on
 * `(workspace_id, kind)`: a workspace emits several kinds over its life (#54's
 * `onboarding_complete` beside the shipped `bot_connected`) and some of them
 * recur per episode rather than once forever (#55's re-link). The composer owns
 * how much recurrence a kind allows; the index only enforces the decision.
 */
export const coachBotNotification = pgTable(
  "coach_bot_notification",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // Open set: which push this row is, so delivery can pick its copy.
    kind: text("kind").notNull().default("bot_connected"),
    dedupeKey: text("dedupe_key").notNull(),
    recipientTelegramId: text("recipient_telegram_id").notNull(),
    // Who this row is addressed to, as the copy sees it: `admin` speaks English
    // beside the delivery loop, `coach` speaks the workspace owner's language
    // from the tri-lingual catalog (#55). One event can queue both, so the role
    // cannot be derived from the kind — and the recipient id alone does not say
    // which vocabulary to reach for. Defaults to `admin`, which every row
    // written before this column existed was.
    recipientRole: text("recipient_role").notNull().default("admin"),
    status: coachBotNotificationStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    uniqueIndex("coach_bot_notification_dedupe_key_idx").on(t.dedupeKey),
    index("coach_bot_notification_delivery_idx").on(t.status, t.availableAt),
  ],
)

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // Open set: `owner` only in MVP.
    role: text("role").notNull().default("owner"),
    // The coach's own language, and theirs alone (#130). The default is what a
    // member is *born* with, not a choice anybody made: creation does not name
    // this column, so the two statements that do — the invite claim seeding it
    // from Telegram, and the coach choosing it during onboarding — are the
    // whole story of how it ever changes.
    language: languageEnum("language").notNull().default("en"),
    // The coach's IANA zone, written silently by the Mini App on every launch
    // that finds it changed, with no UI at all (#56). Not a feature but the
    // precondition for one: the client's confirmation message is printed by the
    // *bot*, in a Worker with no browser, so `Intl…resolvedOptions().timeZone`
    // is unavailable there and without this column it cannot render "10:00" at
    // all. Null until the coach's first launch after this shipped; readers fall
    // back to UTC rather than guessing.
    timezone: text("timezone"),
    // Per-coach choices not worth a column each — the manually hidden Main Mini
    // App hint is the first and, in this slice, the only key. A column rather
    // than Telegram's `CloudStorage` because it must survive a device change and
    // is a fact about the coach, not about the client they launched from.
    settings: jsonb("settings").notNull().default({}),
    // Auth identity — the coach authenticates per launch through their own bot's
    // Mini App, with no server session (ADR 0006). This column is the natural
    // key that verification resolves to a member.
    telegramUserId: text("telegram_user_id"),
    avatarR2Key: text("avatar_r2_key"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true, mode: "date" }),
    // The content-derived version of the terms actually accepted. A record, not
    // a gate: the gate is `terms_accepted_at`, and a bump forces nothing.
    termsVersion: text("terms_version"),
    // Revocation floor: an `initData` older than this is refused however valid
    // its signature. Null means no floor. Sessionless auth would otherwise have
    // no revocation at all; in MVP only workspace deletion writes it.
    credentialsValidFrom: timestamp("credentials_valid_from", {
      withTimezone: true,
      mode: "date",
    }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("member_workspace_id_idx").on(t.workspaceId),
    // One Telegram identity owns at most one workspace (#119's own invariant),
    // which is what makes the credential-to-member lookup single-valued by
    // constraint rather than by tie-break — and indexes the column it probes.
    uniqueIndex("member_owner_telegram_user_id_idx")
      .on(t.telegramUserId)
      .where(sql`${t.role} = 'owner' and ${t.telegramUserId} is not null`),
  ],
)

export const client = pgTable(
  "client",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Chosen by the client at invite acceptance.
    language: languageEnum("language"),
    avatarR2Key: text("avatar_r2_key"),
    // Captured only when the client used Continue with Google; no token stored.
    googleSub: text("google_sub"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("client_workspace_id_idx").on(t.workspaceId)],
)

export const channel = pgTable(
  "channel",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    // Open set: telegram | email | manual in MVP.
    kind: text("kind").notNull(),
    // Telegram user/chat id or email address; null for `manual`.
    address: text("address"),
    isPrimary: boolean("is_primary").notNull().default(false),
    // Telegram profile snapshot captured at acceptance: { name, username, avatarR2Key }.
    telegramSnapshot: jsonb("telegram_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("channel_client_id_idx").on(t.clientId),
    // Exactly one primary channel per client.
    uniqueIndex("channel_one_primary_per_client_idx")
      .on(t.clientId)
      .where(sql`${t.isPrimary}`),
  ],
)

export const invite = pgTable(
  "invite",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    // Single-use, TTL 7 days; re-issuing creates a new invite and expires the old.
    token: text("token").notNull().unique(),
    status: inviteStatusEnum("status").notNull().default("pending"),
    // { kind: telegram | email | link, address? } — how the invite reaches the client.
    delivery: jsonb("delivery").notNull(),
    // Enables recognition on a bare /start; the picker that sets it is deferred (#27).
    expectedTelegramUserId: text("expected_telegram_user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("invite_workspace_id_idx").on(t.workspaceId),
    index("invite_client_id_idx").on(t.clientId),
  ],
)

/**
 * Append-only consent record. "Does the client have consent" is derived from the
 * latest grant: a revocation is a later row with `revoked = true`.
 */
export const consentGrant = pgTable(
  "consent_grant",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("recording_and_processing"),
    revoked: boolean("revoked").notNull().default(false),
    // Consent-text version the client agreed to.
    textVersion: text("text_version").notNull(),
    // The channel kind the grant was given through.
    channelKind: text("channel_kind"),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("consent_grant_client_id_idx").on(t.clientId)],
)

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    // Open set: intake | regular; defaults to intake for a client's first session.
    kind: text("kind").notNull().default("intake"),
    // Human-facing lifecycle — the ONLY status column on session (no god-status).
    state: sessionStateEnum("state").notNull().default("scheduled"),
    closeReason: closeReasonEnum("close_reason"),
    cancelReason: cancelReasonEnum("cancel_reason"),
    noShowDetail: noShowDetailEnum("no_show_detail"),
    // Set exactly once at joint join (scheduled → in_progress).
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("session_workspace_id_idx").on(t.workspaceId),
    index("session_client_id_idx").on(t.clientId),
  ],
)

/**
 * One Join Link token per (session, role) — coach and client each have their own,
 * multi-use, stable across rescheduling.
 */
export const joinLink = pgTable(
  "join_link",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    role: trackParticipantEnum("role").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("join_link_session_role_idx").on(t.sessionId, t.role)],
)

/** 1:1 with a completed session. Audio only; auto-deleted 30 days after the Transcript. */
export const recording = pgTable("recording", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => session.id, { onDelete: "cascade" }),
  egressMetadata: jsonb("egress_metadata"),
  processingStatus: text("processing_status").notNull().default("pending"),
  // Drives the 30-day audio-retention sweep.
  transcriptGeneratedAt: timestamp("transcript_generated_at", { withTimezone: true, mode: "date" }),
  audioDeletedByRetention: boolean("audio_deleted_by_retention").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

/**
 * One track per participant. A track may span multiple R2 segments (a reconnect
 * starts a new egress job); segments are an ordered array here — utterance/segment
 * level DB queries are not an MVP need, so they live as jsonb, not a child table.
 */
export const track = pgTable(
  "track",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recording.id, { onDelete: "cascade" }),
    participant: trackParticipantEnum("participant").notNull(),
    durationSeconds: integer("duration_seconds"),
    // Ordered [{ r2Key, startedAt, order }] — merged downstream.
    segments: jsonb("segments").notNull().default([]),
  },
  (t) => [uniqueIndex("track_recording_participant_idx").on(t.recordingId, t.participant)],
)

/** 1:1 with a track. The raw STT output; provider-format JSON in R2. */
export const trackTranscript = pgTable("track_transcript", {
  id: text("id").primaryKey(),
  trackId: text("track_id")
    .notNull()
    .unique()
    .references(() => track.id, { onDelete: "cascade" }),
  // Provider-agnostic; deepgram first.
  provider: text("provider").notNull().default("deepgram"),
  providerMetadata: jsonb("provider_metadata"),
  r2Key: text("r2_key"),
  processingStatus: text("processing_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

/**
 * 1:1 with a session. The deterministic merge of track transcripts, stored in R2.
 * Regeneration replaces it wholesale; no versioning (versions live on artifacts).
 */
export const transcript = pgTable("transcript", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => session.id, { onDelete: "cascade" }),
  detectedLanguage: text("detected_language"),
  r2Key: text("r2_key"),
  processingStatus: text("processing_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
})

/**
 * An LLM-generated analysis document. Append-only versions; the current artifact
 * per (session, kind) is the latest version. Kind is an open set.
 */
export const artifact = pgTable(
  "artifact",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    // Open set: brief | debrief | mentor_review.
    kind: text("kind").notNull(),
    version: integer("version").notNull().default(1),
    generationStatus: text("generation_status").notNull().default("pending"),
    model: text("model"),
    promptMetadata: jsonb("prompt_metadata"),
    // Markdown body in R2 (DB-text vs R2 is a pipeline decision, #10); reference here.
    r2Key: text("r2_key"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("artifact_session_id_idx").on(t.sessionId),
    uniqueIndex("artifact_session_kind_version_idx").on(t.sessionId, t.kind, t.version),
  ],
)
