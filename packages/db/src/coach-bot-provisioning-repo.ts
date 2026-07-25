import {
  type CoachLanguage,
  CoachOnboardingInviteId,
  type CoachOnboardingInviteStatus,
  TelegramId,
  WorkspaceId,
} from "@praximo/domain"
import { and, desc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database, QueryFailed } from "./client.ts"
import { CoachNotification } from "./coach-notification.ts"
import * as schema from "./schema.ts"

export interface Provisioning {
  readonly id: string
  readonly inviteId: CoachOnboardingInviteId
  readonly workspaceId: WorkspaceId
  readonly coachTelegramId: TelegramId
  readonly keyboardRequestId: number
  /**
   * The manager-chat message carrying this attempt's creation button (#134),
   * once one has been sent. Absent means no prompt of this attempt is live —
   * nothing to disarm, and nothing to confirm in place on activation.
   */
  readonly promptMessageId?: number
  readonly managedBotId?: string
  readonly managedBotUsername?: string
  readonly status: "requested" | "configuring" | "completed"
  readonly workspace: {
    readonly name: string
    readonly avatarR2Key?: string
    readonly description?: string
    readonly shortDescription?: string
  }
  readonly issuedByTelegramId: TelegramId
  /** The owner member's language — every coach-facing bot message is in it. */
  readonly coachLanguage: CoachLanguage
}

/**
 * A BotFather token pasted into the manager chat (#95), parked on the attempt
 * row until the coach proves ownership through the bot it belongs to. The token
 * is an encrypted envelope here exactly as it is once installed; the proof nonce
 * and the webhook secret the candidate bot answers with are held as hashes.
 */
export interface Candidate {
  readonly provisioningId: string
  readonly coachTelegramId: TelegramId
  readonly botId: string
  readonly botUsername: string
  readonly encryptedToken: string
  readonly proofHash: string
  readonly webhookSecretHash: string
  /** `configuring` is a parked candidate whose activation is being retried. */
  readonly status: "requested" | "configuring"
  readonly coachLanguage: CoachLanguage
}

export interface IngestCandidateInput {
  readonly coachTelegramId: TelegramId
  readonly botId: string
  readonly botUsername: string
  readonly encryptedToken: string
  readonly proofHash: string
  readonly webhookSecretHash: string
  readonly now: Date
}

/** An attempt that holds a managed bot it has not activated yet (#150). */
export interface InFlightAttempt {
  readonly id: string
  readonly updatedAt: Date
}

export interface Installation {
  readonly workspaceId: WorkspaceId
  readonly telegramBotId: string
  readonly username: string
  readonly encryptedToken: string
  readonly webhookSecretHash: string
  readonly botInfo: unknown
}

/**
 * What an activation produced. `reconnected` is the one thing only the
 * activating statement can know: whether this workspace's bot was at
 * `needs_relink` when it landed (#55). Every caller-visible consequence hangs
 * off it — the prompt says "reconnected" rather than "setup finished", and the
 * admin gets `relink_completed` rather than nothing.
 */
export interface Activation extends Installation {
  readonly reconnected: boolean
}

export interface PendingNotification {
  readonly id: string
  readonly workspaceId: WorkspaceId
  /** Which push this is — the delivery loop picks its copy from it. */
  readonly kind: string
  /**
   * Whose words this row gets. `admin` is English composed beside the delivery
   * loop; `coach` is the tri-lingual catalog in {@link coachLanguage} (#55). One
   * event can queue both, so the copy is selected on the pair, not the kind.
   */
  readonly recipientRole: CoachNotification.Role
  readonly recipientTelegramId: TelegramId
  readonly workspaceName: string
  readonly botUsername: string
  /** The workspace owner's chosen language, whoever this row is addressed to. */
  readonly coachLanguage: CoachLanguage
  readonly attemptCount: number
}

export interface WorkspaceProfile {
  readonly name: string
  readonly avatarR2Key?: string
  readonly description?: string
  readonly shortDescription?: string
}

export interface CompleteInput {
  readonly provisioningId: string
  readonly encryptedToken: string
  readonly webhookSecretHash: string
  readonly botInfo: unknown
  readonly now: Date
}

export interface RotateInput {
  readonly telegramBotId: string
  readonly encryptedToken: string
  readonly webhookSecretHash: string
  readonly botInfo: unknown
  readonly username: string
  readonly now: Date
}

export interface Interface {
  readonly prepare: (
    inviteId: CoachOnboardingInviteId,
    coachTelegramId: TelegramId,
    now: Date,
  ) => Effect.Effect<Provisioning, ProvisioningUnavailable | QueryFailed>
  readonly claim: (
    coachTelegramId: TelegramId,
    managedBotId: string,
    managedBotUsername: string,
    now: Date,
  ) => Effect.Effect<Provisioning, ProvisioningUnavailable | QueryFailed>
  /**
   * Remember which message carries this attempt's live creation button. Written
   * after the send, since the message id is what the send returns.
   */
  readonly recordPrompt: (
    attemptId: string,
    promptMessageId: number,
    now: Date,
  ) => Effect.Effect<void, QueryFailed>
  readonly ingestCandidate: (
    input: IngestCandidateInput,
  ) => Effect.Effect<Provisioning, ProvisioningUnavailable | QueryFailed>
  readonly findCandidateByBotId: (
    botId: string,
  ) => Effect.Effect<Candidate, CandidateNotFound | QueryFailed>
  readonly complete: (
    input: CompleteInput,
  ) => Effect.Effect<Activation, ProvisioningUnavailable | QueryFailed>
  /**
   * Put a re-linking coach back on the attempt row their first bot came from
   * (#55), and hand it over ready to be prompted again.
   *
   * `provisioningId` and `keyboardRequestId` are pure functions of (invite,
   * coach), so a second row for that pair cannot exist without changing the
   * derivation — reopening the one that does is the only way through. It also
   * lifts the row out of `one_claim_per_invite`, which covers `configuring` and
   * `completed` alone.
   *
   * Idempotent: an attempt already reopened is returned unchanged, so a coach
   * who taps the recovery link twice gets one row and two prompts, the second of
   * which disarms the first.
   *
   * `undefined` means this identity has nothing to recover — not a coach, or a
   * coach whose bot is fine.
   */
  readonly reopenForRelink: (
    coachTelegramId: TelegramId,
    now: Date,
  ) => Effect.Effect<Provisioning | undefined, QueryFailed>
  readonly findByBotId: (
    telegramBotId: string,
  ) => Effect.Effect<Installation, InstallationNotFound | QueryFailed>
  /**
   * The attempt that has claimed this managed bot and not activated it yet, if
   * there is one — `undefined` is the ordinary answer, not a failure.
   *
   * It exists so the bot's own route can tell "this bot is ours and we are not
   * ready" from "we know nothing about this bot" (#150). Arming the webhook now
   * happens after the activation transaction, so on the managed path this should
   * find nothing; the row it returns is what a tripwire log needs to name when it
   * does.
   */
  readonly findInFlightManagedAttempt: (
    telegramBotId: string,
  ) => Effect.Effect<InFlightAttempt | undefined, QueryFailed>
  readonly findByWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Installation, InstallationNotFound | QueryFailed>
  readonly workspaceProfile: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<WorkspaceProfile, InstallationNotFound | QueryFailed>
  readonly rotate: (
    input: RotateInput,
  ) => Effect.Effect<Installation, InstallationNotFound | QueryFailed>
  readonly pendingNotifications: (
    now: Date,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<PendingNotification>, QueryFailed>
  readonly markNotificationDelivered: (id: string, now: Date) => Effect.Effect<void, QueryFailed>
  readonly deferNotification: (id: string, now: Date) => Effect.Effect<void, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/db/CoachBotProvisioningRepo",
) {}

export class ProvisioningUnavailable extends Schema.TaggedErrorClass<ProvisioningUnavailable>()(
  "CoachBotProvisioningRepo.ProvisioningUnavailable",
  {
    reason: Schema.Literals([
      "not-found",
      "expired",
      "used",
      "cancelled",
      "claimed",
      "identity-conflict",
    ]),
  },
) {}

/**
 * Why an invite cannot carry this identity's provisioning attempt. Called only
 * once `prepare` has already tried to take the claim, so an invite that is not
 * `accepted` by the caller by then is one somebody else holds.
 *
 * `claimed` is deliberately the answer for every foreign claim — the reply must
 * not disclose who holds it (#112) — while `cancelled` stays distinct because
 * it is the fence a reset raises against an attempt still in flight.
 */
const unavailableReason = (
  invite: { readonly status: CoachOnboardingInviteStatus; readonly expiresAt: Date },
  now: Date,
): "expired" | "used" | "cancelled" | "claimed" => {
  switch (invite.status) {
    case "used":
      return "used"
    case "cancelled":
      return "cancelled"
    case "expired":
      return "expired"
    // A `pending` row that survived the accepting write is one another identity
    // took first and this snapshot has not caught up to; only a lapsed TTL is
    // genuinely an expiry.
    case "pending":
      return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "claimed"
    case "accepted":
      return "claimed"
  }
}

export class InstallationNotFound extends Schema.TaggedErrorClass<InstallationNotFound>()(
  "CoachBotProvisioningRepo.InstallationNotFound",
  { key: Schema.String },
) {}

/**
 * No bot of this id has a credential parked awaiting its ownership proof. Its
 * own error rather than `InstallationNotFound`: on the handshake route an
 * installation is what does not exist yet, by definition (#95).
 */
export class CandidateNotFound extends Schema.TaggedErrorClass<CandidateNotFound>()(
  "CoachBotProvisioningRepo.CandidateNotFound",
  { botId: Schema.String },
) {}

const keyboardRequestId = (inviteId: string, coachTelegramId: string): number => {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(`${inviteId}:${coachTelegramId}`)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

const provisioningId = (inviteId: string, coachTelegramId: string): string =>
  `cbp_${inviteId.slice(3)}_${coachTelegramId}`

/**
 * The fence every advancing write puts on an attempt row aliased `candidate`,
 * joined to its invite as `invite`: it must be this identity's newest open
 * attempt, on an invite this identity holds — or one still unclaimed and
 * unexpired — that nobody else has already won.
 *
 * An accepted claim only carries the attempt of the identity that took it: a bot
 * offered by anyone else must never consume another coach's reserved workspace
 * (#112).
 */
const openAttemptFence = (coachTelegramId: TelegramId, now: Date) => sql`
  "candidate"."coach_telegram_id" = ${coachTelegramId}
  and "candidate"."id" = (
    select "latest"."id"
    from "coach_bot_provisioning" as "latest"
    where
      "latest"."coach_telegram_id" = ${coachTelegramId}
      and "latest"."status" = 'requested'
    order by "latest"."updated_at" desc
    limit 1
  )
  and "candidate"."status" = 'requested'
  and (
    (
      "invite"."status" = 'accepted'
      and "invite"."accepted_by_telegram_id" = "candidate"."coach_telegram_id"
    )
    or ("invite"."status" = 'pending' and "invite"."expires_at" > ${now})
    -- Re-linking (#55). The invitation is spent and its public code is dead —
    -- recovery is never entered through it — so the used arm is what carries a
    -- coach whose bot became unreachable back through the very same attempt row.
    -- Fenced on the workspace's own state rather than on the invite alone: only
    -- a bot that needs re-linking reopens anything, so a finished onboarding
    -- cannot be re-entered by a coach who simply creates a second bot (#135).
    or (
      "invite"."status" = 'used'
      and "invite"."accepted_by_telegram_id" = "candidate"."coach_telegram_id"
      and exists (
        select 1
        from "bot"
        where
          "bot"."workspace_id" = "candidate"."workspace_id"
          and "bot"."connection_status" = 'needs_relink'
      )
    )
  )
  and not exists (
    select 1
    from "coach_bot_provisioning" as "winner"
    where
      "winner"."invite_id" = "candidate"."invite_id"
      and "winner"."status" in ('configuring', 'completed')
  )
`

const nextAttemptAt = (now: Date, attemptCount: number): Date =>
  new Date(now.getTime() + Math.min(60, 2 ** Math.min(attemptCount, 6)) * 60_000)

const decodeInstallation = (row: {
  workspaceId: string
  telegramBotId: string | null
  username: string | null
  token: string | null
  webhookSecretHash: string | null
  botInfo: unknown
}): Installation | undefined =>
  row.telegramBotId === null ||
  row.username === null ||
  row.token === null ||
  row.webhookSecretHash === null ||
  row.botInfo === null
    ? undefined
    : {
        workspaceId: WorkspaceId.make(row.workspaceId),
        telegramBotId: row.telegramBotId,
        username: row.username,
        encryptedToken: row.token,
        webhookSecretHash: row.webhookSecretHash,
        botInfo: row.botInfo,
      }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    const loadProvisioning = Effect.fn("CoachBotProvisioningRepo.loadProvisioning")(function* (
      coachTelegramId: TelegramId,
      requestId: number,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              id: schema.coachBotProvisioning.id,
              inviteId: schema.coachBotProvisioning.inviteId,
              workspaceId: schema.coachBotProvisioning.workspaceId,
              coachTelegramId: schema.coachBotProvisioning.coachTelegramId,
              requestId: schema.coachBotProvisioning.keyboardRequestId,
              promptMessageId: schema.coachBotProvisioning.promptMessageId,
              managedBotId: schema.coachBotProvisioning.managedBotId,
              managedBotUsername: schema.coachBotProvisioning.managedBotUsername,
              status: schema.coachBotProvisioning.status,
              name: schema.workspace.name,
              avatarR2Key: schema.workspace.avatarR2Key,
              description: schema.workspace.description,
              shortDescription: schema.workspace.shortDescription,
              issuedByTelegramId: schema.coachOnboardingInvite.issuedByTelegramId,
              coachLanguage: schema.member.language,
            })
            .from(schema.coachBotProvisioning)
            .innerJoin(
              schema.coachOnboardingInvite,
              eq(schema.coachOnboardingInvite.id, schema.coachBotProvisioning.inviteId),
            )
            .innerJoin(
              schema.workspace,
              eq(schema.workspace.id, schema.coachBotProvisioning.workspaceId),
            )
            .innerJoin(
              schema.member,
              and(
                eq(schema.member.workspaceId, schema.coachBotProvisioning.workspaceId),
                eq(schema.member.role, "owner"),
              ),
            )
            .where(
              and(
                eq(schema.coachBotProvisioning.coachTelegramId, coachTelegramId),
                eq(schema.coachBotProvisioning.keyboardRequestId, requestId),
              ),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "provisioning.load", cause }),
      })
      const row = rows[0]
      if (row === undefined) return undefined
      return {
        id: row.id,
        inviteId: CoachOnboardingInviteId.make(row.inviteId),
        workspaceId: WorkspaceId.make(row.workspaceId),
        coachTelegramId: TelegramId.make(row.coachTelegramId),
        keyboardRequestId: row.requestId,
        ...(row.promptMessageId === null ? {} : { promptMessageId: row.promptMessageId }),
        ...(row.managedBotId === null ? {} : { managedBotId: row.managedBotId }),
        ...(row.managedBotUsername === null ? {} : { managedBotUsername: row.managedBotUsername }),
        status: row.status,
        workspace: {
          name: row.name,
          ...(row.avatarR2Key === null ? {} : { avatarR2Key: row.avatarR2Key }),
          ...(row.description === null ? {} : { description: row.description }),
          ...(row.shortDescription === null ? {} : { shortDescription: row.shortDescription }),
        },
        issuedByTelegramId: TelegramId.make(row.issuedByTelegramId),
        coachLanguage: row.coachLanguage,
      } satisfies Provisioning
    })

    /**
     * The accepting `/start` (#106, contract in #112). One statement takes the
     * exclusive claim and opens this identity's provisioning attempt:
     *
     * - `accepting` is the compare-and-set. Only an unexpired `pending` invite
     *   matches, so the first valid `/start` wins outright and every later one
     *   sees a row it cannot transition.
     * - `claimant` adds the resume branch. A data-modifying CTE is invisible to
     *   the rest of the statement, so the second arm still reads the pre-update
     *   status: when the acceptance lands the arm is empty, and when this same
     *   identity is returning it is the only row. Exactly one row reaches the
     *   insert, and a foreign claimant reaches none.
     *
     * The attempt row is keyed by (identity, keyboard request), so a repeated
     * `/start` re-touches its own row rather than opening a second one.
     */
    const prepare = Effect.fn("CoachBotProvisioningRepo.prepare")(function* (
      inviteId: CoachOnboardingInviteId,
      coachTelegramId: TelegramId,
      now: Date,
    ) {
      const requestId = keyboardRequestId(inviteId, coachTelegramId)
      yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with accepting as (
              update "coach_onboarding_invite"
              set
                "status" = 'accepted',
                "accepted_by_telegram_id" = ${coachTelegramId},
                "accepted_at" = ${now}
              where
                "id" = ${inviteId}
                and "status" = 'pending'
                and "expires_at" > ${now}
              returning "id", "workspace_id"
            ),
            claimant as (
              select "id", "workspace_id" from accepting
              union all
              select "id", "workspace_id"
              from "coach_onboarding_invite"
              where
                "id" = ${inviteId}
                and "status" = 'accepted'
                and "accepted_by_telegram_id" = ${coachTelegramId}
            )
            insert into "coach_bot_provisioning" (
              "id", "invite_id", "workspace_id", "coach_telegram_id",
              "keyboard_request_id", "status", "created_at", "updated_at"
            )
            select
              ${provisioningId(inviteId, coachTelegramId)},
              "id",
              "workspace_id",
              ${coachTelegramId},
              ${requestId},
              'requested',
              ${now},
              ${now}
            from claimant
            on conflict ("coach_telegram_id", "keyboard_request_id")
            do update set "updated_at" = excluded."updated_at"
          `),
        catch: (cause) => new QueryFailed({ operation: "provisioning.prepare", cause }),
      })
      const prepared = yield* loadProvisioning(coachTelegramId, requestId)
      const inviteRows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              status: schema.coachOnboardingInvite.status,
              expiresAt: schema.coachOnboardingInvite.expiresAt,
              acceptedByTelegramId: schema.coachOnboardingInvite.acceptedByTelegramId,
            })
            .from(schema.coachOnboardingInvite)
            .where(eq(schema.coachOnboardingInvite.id, inviteId))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "provisioning.prepare.inspect", cause }),
      })
      const invite = inviteRows[0]
      if (invite === undefined) return yield* new ProvisioningUnavailable({ reason: "not-found" })

      const claimedByCaller =
        invite.status === "accepted" && invite.acceptedByTelegramId === coachTelegramId
      if (claimedByCaller && prepared !== undefined) return prepared
      if (claimedByCaller) {
        // The claim is this identity's own, so nothing about the invite explains
        // a missing attempt row: that is a broken write, not a refused claim.
        return yield* new QueryFailed({
          operation: "provisioning.prepare.attempt",
          cause: new Error("claim was accepted but its provisioning attempt is missing"),
        })
      }
      return yield* new ProvisioningUnavailable({ reason: unavailableReason(invite, now) })
    })

    /** The invite behind this identity's newest open attempt, if it has one. */
    const openAttempt = Effect.fn("CoachBotProvisioningRepo.openAttempt")(function* (
      coachTelegramId: TelegramId,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              status: schema.coachOnboardingInvite.status,
              expiresAt: schema.coachOnboardingInvite.expiresAt,
              acceptedByTelegramId: schema.coachOnboardingInvite.acceptedByTelegramId,
            })
            .from(schema.coachBotProvisioning)
            .innerJoin(
              schema.coachOnboardingInvite,
              eq(schema.coachOnboardingInvite.id, schema.coachBotProvisioning.inviteId),
            )
            .where(
              and(
                eq(schema.coachBotProvisioning.coachTelegramId, coachTelegramId),
                eq(schema.coachBotProvisioning.status, "requested"),
              ),
            )
            .orderBy(desc(schema.coachBotProvisioning.updatedAt))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "provisioning.openAttempt", cause }),
      })
      return rows[0]
    })

    const claim = Effect.fn("CoachBotProvisioningRepo.claim")(function* (
      coachTelegramId: TelegramId,
      managedBotId: string,
      managedBotUsername: string,
      now: Date,
    ) {
      yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            update "coach_bot_provisioning" as "candidate"
            set
              "status" = 'configuring',
              "managed_bot_id" = ${managedBotId},
              "managed_bot_username" = ${managedBotUsername},
              "updated_at" = ${now}
            from "coach_onboarding_invite" as "invite"
            where
              "candidate"."invite_id" = "invite"."id"
              and ${openAttemptFence(coachTelegramId, now)}
          `),
        catch: (cause) => new QueryFailed({ operation: "provisioning.claim", cause }),
      })
      const claimedRows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ requestId: schema.coachBotProvisioning.keyboardRequestId })
            .from(schema.coachBotProvisioning)
            .where(
              and(
                eq(schema.coachBotProvisioning.coachTelegramId, coachTelegramId),
                eq(schema.coachBotProvisioning.managedBotId, managedBotId),
              ),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "provisioning.claim.inspect", cause }),
      })
      const claimed =
        claimedRows[0] === undefined
          ? undefined
          : yield* loadProvisioning(coachTelegramId, claimedRows[0].requestId)
      if (
        claimed !== undefined &&
        claimed.managedBotId === managedBotId &&
        claimed.status !== "requested"
      ) {
        return claimed
      }
      if (claimed !== undefined) return yield* new ProvisioningUnavailable({ reason: "claimed" })
      // Same reading `ingestCandidate` makes of its own refusal, and load-bearing
      // for the one-tap path: `not-found` is what the manager webhook treats as
      // the terminal "this coach has no open attempt" and answers 200 to (#135),
      // so an attempt still open on an invitation an administrator reset must
      // name the invitation rather than pass for an identity that never started.
      const attempt = yield* openAttempt(coachTelegramId)
      if (attempt === undefined) return yield* new ProvisioningUnavailable({ reason: "not-found" })
      return yield* new ProvisioningUnavailable({ reason: unavailableReason(attempt, now) })
    })

    /**
     * The message id of the creation button now live in the coach's chat (#134).
     *
     * Touching `updated_at` is deliberate: the attempt whose button a coach can
     * actually tap is the one an incoming `managed_bot` update should advance,
     * and that is exactly what the open-attempt fence orders on.
     */
    const recordPrompt = Effect.fn("CoachBotProvisioningRepo.recordPrompt")(function* (
      attemptId: string,
      promptMessageId: number,
      now: Date,
    ) {
      yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.coachBotProvisioning)
            .set({ promptMessageId, updatedAt: now })
            .where(eq(schema.coachBotProvisioning.id, attemptId)),
        catch: (cause) => new QueryFailed({ operation: "provisioning.recordPrompt", cause }),
      })
    })

    /**
     * Park a pasted BotFather credential on the coach's open attempt (#95).
     *
     * Deliberately the same fences `claim` applies — the identity that took the
     * invite, an invite nobody else has won — but the attempt stays `requested`:
     * a pasted token buys nothing until the coach answers the proof handshake
     * through the bot it belongs to. Only then does `claim` advance the row, so
     * both onboarding paths converge on one activation.
     *
     * Re-pasting overwrites the parked candidate, which is what makes a failed
     * or abandoned attempt resumable: the previous nonce and webhook secret stop
     * being accepted the moment a new one lands.
     */
    const ingestCandidate = Effect.fn("CoachBotProvisioningRepo.ingestCandidate")(function* (
      input: IngestCandidateInput,
    ) {
      yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            update "coach_bot_provisioning" as "candidate"
            set
              "candidate_bot_id" = ${input.botId},
              "candidate_bot_username" = ${input.botUsername},
              "candidate_token" = ${input.encryptedToken},
              "candidate_proof_hash" = ${input.proofHash},
              "candidate_webhook_secret_hash" = ${input.webhookSecretHash},
              "candidate_ingested_at" = ${input.now},
              "updated_at" = ${input.now}
            from "coach_onboarding_invite" as "invite"
            where
              "candidate"."invite_id" = "invite"."id"
              and ${openAttemptFence(input.coachTelegramId, input.now)}
              -- The partial unique index would raise this as a constraint
              -- violation; refusing it here keeps a bot somebody else is already
              -- onboarding a typed answer rather than a query failure.
              and not exists (
                select 1
                from "coach_bot_provisioning" as "other"
                where
                  "other"."candidate_bot_id" = ${input.botId}
                  and "other"."status" <> 'completed'
                  and "other"."id" <> "candidate"."id"
              )
          `),
        catch: (cause) => new QueryFailed({ operation: "provisioning.ingestCandidate", cause }),
      })
      const ingestedRows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ requestId: schema.coachBotProvisioning.keyboardRequestId })
            .from(schema.coachBotProvisioning)
            .where(
              and(
                eq(schema.coachBotProvisioning.coachTelegramId, input.coachTelegramId),
                eq(schema.coachBotProvisioning.candidateBotId, input.botId),
                eq(schema.coachBotProvisioning.status, "requested"),
              ),
            )
            .limit(1),
        catch: (cause) =>
          new QueryFailed({ operation: "provisioning.ingestCandidate.inspect", cause }),
      })
      const requestId = ingestedRows[0]?.requestId
      if (requestId !== undefined) {
        const ingested = yield* loadProvisioning(input.coachTelegramId, requestId)
        if (ingested !== undefined) return ingested
      }
      // Why the paste was refused is the invite's answer, not the token's: the
      // coach is told their link expired or was used, rather than a flat "no
      // active setup" that fits only an identity with no attempt at all.
      const attempt = yield* openAttempt(input.coachTelegramId)
      if (attempt === undefined) return yield* new ProvisioningUnavailable({ reason: "not-found" })
      const heldByCaller =
        attempt.status === "accepted" && attempt.acceptedByTelegramId === input.coachTelegramId
      const stillOffered = attempt.status === "pending" && attempt.expiresAt > input.now
      return yield* new ProvisioningUnavailable({
        reason: heldByCaller || stillOffered ? "claimed" : unavailableReason(attempt, input.now),
      })
    })

    const findCandidateByBotId = Effect.fn("CoachBotProvisioningRepo.findCandidateByBotId")(
      function* (botId: string) {
        const rows = yield* Effect.tryPromise({
          try: () =>
            client
              .select({
                provisioningId: schema.coachBotProvisioning.id,
                coachTelegramId: schema.coachBotProvisioning.coachTelegramId,
                botUsername: schema.coachBotProvisioning.candidateBotUsername,
                encryptedToken: schema.coachBotProvisioning.candidateToken,
                proofHash: schema.coachBotProvisioning.candidateProofHash,
                webhookSecretHash: schema.coachBotProvisioning.candidateWebhookSecretHash,
                status: schema.coachBotProvisioning.status,
                coachLanguage: schema.member.language,
              })
              .from(schema.coachBotProvisioning)
              .innerJoin(
                schema.member,
                and(
                  eq(schema.member.workspaceId, schema.coachBotProvisioning.workspaceId),
                  eq(schema.member.role, "owner"),
                ),
              )
              .where(
                and(
                  eq(schema.coachBotProvisioning.candidateBotId, botId),
                  sql`${schema.coachBotProvisioning.status} <> 'completed'`,
                ),
              )
              .limit(1),
          catch: (cause) => new QueryFailed({ operation: "provisioning.findCandidate", cause }),
        })
        const row = rows[0]
        if (
          row === undefined ||
          row.botUsername === null ||
          row.encryptedToken === null ||
          row.proofHash === null ||
          row.webhookSecretHash === null ||
          row.status === "completed"
        ) {
          return yield* new CandidateNotFound({ botId })
        }
        return {
          provisioningId: row.provisioningId,
          coachTelegramId: TelegramId.make(row.coachTelegramId),
          botId,
          botUsername: row.botUsername,
          encryptedToken: row.encryptedToken,
          proofHash: row.proofHash,
          webhookSecretHash: row.webhookSecretHash,
          status: row.status,
          coachLanguage: row.coachLanguage,
        } satisfies Candidate
      },
    )

    /**
     * Activation, and the one statement that also closes a re-link.
     *
     * `previous_bot` is read from the pre-statement snapshot, so it still says
     * what this workspace's bot was *before* the upsert below rewrites it. That
     * is the only place the difference between a first connection and a recovery
     * is visible: afterwards both rows read `connected` (#55).
     */
    const complete = Effect.fn("CoachBotProvisioningRepo.complete")(function* (
      input: CompleteInput,
    ) {
      const relinkKind = CoachNotification.Kind.RelinkCompleted
      const relinkWorkspace = sql`"completed_attempt"."workspace_id"`
      const relinkEpisode = sql`"previous_bot"."relink_episode"::text`
      const rows = yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            with candidate as (
              select
                "attempt"."id",
                "attempt"."invite_id",
                "attempt"."workspace_id",
                "attempt"."coach_telegram_id",
                "attempt"."managed_bot_id",
                "attempt"."managed_bot_username",
                "invite"."issued_by_telegram_id"
              from "coach_bot_provisioning" as "attempt"
              join "coach_onboarding_invite" as "invite"
                on "invite"."id" = "attempt"."invite_id"
              join "member" as "owner"
                on "owner"."workspace_id" = "attempt"."workspace_id"
                and "owner"."role" = 'owner'
              where
                "attempt"."id" = ${input.provisioningId}
                and "attempt"."status" in ('configuring', 'completed')
                -- The same identity fence the claim step applies: an accepted
                -- invite only ever completes for the identity that took the
                -- claim (#106), never for whoever holds an attempt row.
                and (
                  "invite"."status" = 'pending'
                  or (
                    "invite"."status" = 'accepted'
                    and "invite"."accepted_by_telegram_id" = "attempt"."coach_telegram_id"
                  )
                  or "attempt"."status" = 'completed'
                  -- The re-link arm (#55), fenced the same way the open-attempt
                  -- fence fences its own: a spent invitation activates nothing
                  -- unless this workspace's bot is the one asking to come back.
                  or (
                    "invite"."status" = 'used'
                    and "invite"."accepted_by_telegram_id" = "attempt"."coach_telegram_id"
                    and exists (
                      select 1
                      from "bot"
                      where
                        "bot"."workspace_id" = "attempt"."workspace_id"
                        and "bot"."connection_status" = 'needs_relink'
                    )
                  )
                )
                and (
                  "owner"."telegram_user_id" is null
                  or "owner"."telegram_user_id" = "attempt"."coach_telegram_id"
                )
            ),
            previous_bot as (
              select
                "bot"."workspace_id",
                "bot"."connection_status",
                "bot"."relink_episode"
              from "bot"
              join candidate on candidate."workspace_id" = "bot"."workspace_id"
            ),
            connected_bot as (
              insert into "bot" (
                "workspace_id", "token", "telegram_bot_id", "username", "bot_info",
                "webhook_secret_hash", "connection_status", "health_checked_at",
                "created_at", "updated_at"
              )
              select
                "workspace_id", ${input.encryptedToken}, "managed_bot_id",
                "managed_bot_username", ${JSON.stringify(input.botInfo)}::jsonb,
                ${input.webhookSecretHash}, 'connected', ${input.now},
                ${input.now}, ${input.now}
              from candidate
              where "managed_bot_id" is not null and "managed_bot_username" is not null
              -- A coach who re-links to a *different* bot rewrites this row in
              -- place: the table is keyed by workspace, so the old bot id simply
              -- stops being ours (#55). The unique index on it only bites when
              -- the new bot already belongs to another workspace, which is the
              -- existing "bot already taken" refusal.
              on conflict ("workspace_id") do update set
                "token" = excluded."token",
                "telegram_bot_id" = excluded."telegram_bot_id",
                "username" = excluded."username",
                "bot_info" = excluded."bot_info",
                "webhook_secret_hash" = excluded."webhook_secret_hash",
                "connection_status" = 'connected',
                -- Telegram has just answered this credential, so the sweep has
                -- nothing to learn from it for another day.
                "health_checked_at" = excluded."health_checked_at",
                "updated_at" = excluded."updated_at"
              returning *
            ),
            claimed_owner as (
              update "member"
              set "telegram_user_id" = candidate."coach_telegram_id", "updated_at" = ${input.now}
              from candidate
              where
                "member"."workspace_id" = candidate."workspace_id"
                and "member"."role" = 'owner'
                and (
                  "member"."telegram_user_id" is null
                  or "member"."telegram_user_id" = candidate."coach_telegram_id"
                )
              returning "member"."workspace_id"
            ),
            consumed_invite as (
              update "coach_onboarding_invite"
              set "status" = 'used', "used_at" = ${input.now}
              from candidate
              where
                "coach_onboarding_invite"."id" = candidate."invite_id"
                and exists (
                  select 1 from claimed_owner
                  where claimed_owner."workspace_id" = candidate."workspace_id"
                )
              returning "coach_onboarding_invite"."id"
            ),
            completed_attempt as (
              update "coach_bot_provisioning"
              set
                "status" = 'completed',
                "updated_at" = ${input.now},
                -- The installed credential now lives on the bot row; the pasted
                -- envelope and the one-shot proof secrets have no reason to
                -- outlive the handshake that consumed them (#95).
                "candidate_token" = null,
                "candidate_proof_hash" = null,
                "candidate_webhook_secret_hash" = null
              from candidate
              where
                "coach_bot_provisioning"."id" = candidate."id"
                and exists (select 1 from consumed_invite)
              returning candidate.*
            ),
            queued_notification as (
              insert into "coach_bot_notification" (
                "id", "workspace_id", "kind", "dedupe_key", "recipient_telegram_id", "status",
                "attempt_count", "available_at", "created_at", "updated_at"
              )
              select
                ${CoachNotification.id(CoachNotification.Kind.BotConnected, sql`"workspace_id"`)},
                "workspace_id",
                ${CoachNotification.Kind.BotConnected},
                ${CoachNotification.dedupeKey(CoachNotification.Kind.BotConnected, sql`"workspace_id"`)},
                "issued_by_telegram_id", 'pending', 0,
                ${input.now}, ${input.now}, ${input.now}
              from completed_attempt
              on conflict ("dedupe_key") do nothing
            ),
            -- The admin heard about the outage; they hear about its end here
            -- (#55). The bot_connected row cannot carry this — its key was taken
            -- by the first connection and its insert does nothing on conflict —
            -- so a recovery gets a kind and an episode of its own.
            queued_relink_notification as (
              insert into "coach_bot_notification" (
                "id", "workspace_id", "kind", "dedupe_key", "recipient_role",
                "recipient_telegram_id", "status", "attempt_count", "available_at",
                "created_at", "updated_at"
              )
              select
                ${CoachNotification.id(relinkKind, relinkWorkspace, relinkEpisode)},
                "completed_attempt"."workspace_id",
                ${relinkKind},
                ${CoachNotification.dedupeKey(relinkKind, relinkWorkspace, relinkEpisode)},
                ${CoachNotification.Role.Admin},
                "completed_attempt"."issued_by_telegram_id", 'pending', 0,
                ${input.now}, ${input.now}, ${input.now}
              from completed_attempt
              join previous_bot
                on "previous_bot"."workspace_id" = "completed_attempt"."workspace_id"
              where "previous_bot"."connection_status" = 'needs_relink'
              on conflict ("dedupe_key") do nothing
            )
            select
              connected_bot.*,
              exists (
                select 1 from previous_bot where "connection_status" = 'needs_relink'
              ) as "reconnected"
            from connected_bot
            where exists (select 1 from completed_attempt)
          `),
        catch: (cause) => new QueryFailed({ operation: "provisioning.complete", cause }),
      })
      const row = rows.rows[0] as
        | {
            workspace_id: string
            telegram_bot_id: string | null
            username: string | null
            token: string | null
            webhook_secret_hash: string | null
            bot_info: unknown
            reconnected: boolean
          }
        | undefined
      const installation =
        row === undefined
          ? undefined
          : decodeInstallation({
              workspaceId: row.workspace_id,
              telegramBotId: row.telegram_bot_id,
              username: row.username,
              token: row.token,
              webhookSecretHash: row.webhook_secret_hash,
              botInfo: row.bot_info,
            })
      if (installation !== undefined && row !== undefined) {
        return { ...installation, reconnected: row.reconnected } satisfies Activation
      }
      return yield* new ProvisioningUnavailable({ reason: "identity-conflict" })
    })

    /**
     * The re-link reopen (#55). Two statements rather than one because the
     * second is also the answer for a coach who is *already* reopened — the
     * update matches nothing on their second tap, and refusing them then would
     * make the recovery link work exactly once.
     *
     * The ownership fence is the owner membership, not the invite's claim: the
     * membership is what a connected bot actually wrote, and it is the same fence
     * `complete` re-applies when the new bot arrives.
     */
    const reopenForRelink = Effect.fn("CoachBotProvisioningRepo.reopenForRelink")(function* (
      coachTelegramId: TelegramId,
      now: Date,
    ) {
      yield* Effect.tryPromise({
        try: () =>
          client.execute(sql`
            update "coach_bot_provisioning" as "attempt"
            set "status" = 'requested', "updated_at" = ${now}
            from "bot"
            where
              "bot"."workspace_id" = "attempt"."workspace_id"
              and "bot"."connection_status" = 'needs_relink'
              and "attempt"."coach_telegram_id" = ${coachTelegramId}
              and "attempt"."status" = 'completed'
              and exists (
                select 1
                from "member" as "owner"
                where
                  "owner"."workspace_id" = "attempt"."workspace_id"
                  and "owner"."role" = 'owner'
                  and "owner"."telegram_user_id" = "attempt"."coach_telegram_id"
              )
          `),
        catch: (cause) => new QueryFailed({ operation: "provisioning.reopenForRelink", cause }),
      })
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ requestId: schema.coachBotProvisioning.keyboardRequestId })
            .from(schema.coachBotProvisioning)
            .innerJoin(
              schema.bot,
              eq(schema.bot.workspaceId, schema.coachBotProvisioning.workspaceId),
            )
            .where(
              and(
                eq(schema.coachBotProvisioning.coachTelegramId, coachTelegramId),
                eq(schema.coachBotProvisioning.status, "requested"),
                eq(schema.bot.connectionStatus, "needs_relink"),
              ),
            )
            .orderBy(desc(schema.coachBotProvisioning.updatedAt))
            .limit(1),
        catch: (cause) =>
          new QueryFailed({ operation: "provisioning.reopenForRelink.inspect", cause }),
      })
      const requestId = rows[0]?.requestId
      if (requestId === undefined) return undefined
      return yield* loadProvisioning(coachTelegramId, requestId)
    })

    const loadInstallation = Effect.fn("CoachBotProvisioningRepo.loadInstallation")(function* (
      key: string,
      column: "bot" | "workspace",
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              workspaceId: schema.bot.workspaceId,
              telegramBotId: schema.bot.telegramBotId,
              username: schema.bot.username,
              token: schema.bot.token,
              webhookSecretHash: schema.bot.webhookSecretHash,
              botInfo: schema.bot.botInfo,
            })
            .from(schema.bot)
            .where(
              column === "bot"
                ? eq(schema.bot.telegramBotId, key)
                : eq(schema.bot.workspaceId, key),
            )
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "installation.load", cause }),
      })
      const installation = rows[0] === undefined ? undefined : decodeInstallation(rows[0])
      return installation === undefined ? yield* new InstallationNotFound({ key }) : installation
    })

    const findByBotId = (id: string) => loadInstallation(id, "bot")
    const findByWorkspace = (id: WorkspaceId) => loadInstallation(id, "workspace")

    /**
     * Read straight off the attempt rather than inferring it from the absence of
     * an installation: `configuring` on this bot id is the state that says *we*
     * put the webhook there and have not finished, which is what makes an update
     * arriving now worth redelivering rather than refusing (#150).
     */
    const findInFlightManagedAttempt = Effect.fn(
      "CoachBotProvisioningRepo.findInFlightManagedAttempt",
    )(function* (telegramBotId: string) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              id: schema.coachBotProvisioning.id,
              updatedAt: schema.coachBotProvisioning.updatedAt,
            })
            .from(schema.coachBotProvisioning)
            .where(
              and(
                eq(schema.coachBotProvisioning.managedBotId, telegramBotId),
                eq(schema.coachBotProvisioning.status, "configuring"),
              ),
            )
            .limit(1),
        catch: (cause) =>
          new QueryFailed({ operation: "provisioning.findInFlightManagedAttempt", cause }),
      })
      const row = rows[0]
      return row === undefined ? undefined : ({ ...row } satisfies InFlightAttempt)
    })

    const workspaceProfile = Effect.fn("CoachBotProvisioningRepo.workspaceProfile")(function* (
      workspaceId: WorkspaceId,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({
              name: schema.workspace.name,
              avatarR2Key: schema.workspace.avatarR2Key,
              description: schema.workspace.description,
              shortDescription: schema.workspace.shortDescription,
            })
            .from(schema.workspace)
            .where(eq(schema.workspace.id, workspaceId))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "workspace.profile", cause }),
      })
      const row = rows[0]
      if (row === undefined) return yield* new InstallationNotFound({ key: workspaceId })
      return {
        name: row.name,
        ...(row.avatarR2Key === null ? {} : { avatarR2Key: row.avatarR2Key }),
        ...(row.description === null ? {} : { description: row.description }),
        ...(row.shortDescription === null ? {} : { shortDescription: row.shortDescription }),
      } satisfies WorkspaceProfile
    })

    const rotate = Effect.fn("CoachBotProvisioningRepo.rotate")(function* (input: RotateInput) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.bot)
            .set({
              token: input.encryptedToken,
              username: input.username,
              botInfo: input.botInfo,
              webhookSecretHash: input.webhookSecretHash,
              // Every caller of this has just held a working credential in its
              // hand — a re-configuration, or the repair that refreshed one
              // (#55) — so the sweep has nothing left to ask about this bot.
              healthCheckedAt: input.now,
              updatedAt: input.now,
            })
            .where(eq(schema.bot.telegramBotId, input.telegramBotId))
            .returning({
              workspaceId: schema.bot.workspaceId,
              telegramBotId: schema.bot.telegramBotId,
              username: schema.bot.username,
              token: schema.bot.token,
              webhookSecretHash: schema.bot.webhookSecretHash,
              botInfo: schema.bot.botInfo,
            }),
        catch: (cause) => new QueryFailed({ operation: "installation.rotate", cause }),
      })
      const installation = rows[0] === undefined ? undefined : decodeInstallation(rows[0])
      return installation === undefined
        ? yield* new InstallationNotFound({ key: input.telegramBotId })
        : installation
    })

    const pendingNotifications = Effect.fn("CoachBotProvisioningRepo.pendingNotifications")(
      function* (now: Date, limit: number) {
        const leaseUntil = new Date(now.getTime() + 5 * 60_000)
        const result = yield* Effect.tryPromise({
          try: () =>
            client.execute(sql`
            with candidates as (
              select "id"
              from "coach_bot_notification"
              where "status" = 'pending' and "available_at" <= ${now}
              order by "available_at"
              limit ${limit}
              for update skip locked
            ),
            claimed as (
              update "coach_bot_notification" as "notification"
              set
                "attempt_count" = "notification"."attempt_count" + 1,
                "available_at" = ${leaseUntil},
                "updated_at" = ${now}
              from candidates
              where "notification"."id" = candidates."id"
              returning "notification".*
            )
            select
              claimed."id",
              claimed."workspace_id",
              claimed."kind",
              claimed."recipient_role",
              claimed."recipient_telegram_id",
              claimed."attempt_count",
              "workspace"."name" as "workspace_name",
              "bot"."username" as "bot_username",
              "owner"."language" as "coach_language"
            from claimed
            -- Every current kind is about a workspace whose bot exists, and each
            -- names it in its copy, so the inner join and the null-username
            -- filter below are load-bearing rather than incidental. A future
            -- pre-bot push (#119's "setup started") has to relax them. The owner
            -- join is inner for the same reason: a coach-addressed row has no
            -- language without it, and a workspace with a bot always has one.
            join "workspace" on "workspace"."id" = claimed."workspace_id"
            join "bot" on "bot"."workspace_id" = claimed."workspace_id"
            join "member" as "owner"
              on "owner"."workspace_id" = claimed."workspace_id"
              and "owner"."role" = 'owner'
          `),
          catch: (cause) => new QueryFailed({ operation: "notification.pending", cause }),
        })
        return (
          result.rows as unknown as ReadonlyArray<{
            id: string
            workspace_id: string
            kind: string
            recipient_role: string
            recipient_telegram_id: string
            workspace_name: string
            bot_username: string | null
            coach_language: CoachLanguage
            attempt_count: number
          }>
        ).flatMap((row) =>
          row.bot_username === null
            ? []
            : [
                {
                  id: row.id,
                  workspaceId: WorkspaceId.make(row.workspace_id),
                  kind: row.kind,
                  // Anything that is not the coach is the admin, which is what
                  // the column's own default says of every row written before it
                  // existed.
                  recipientRole:
                    row.recipient_role === CoachNotification.Role.Coach
                      ? CoachNotification.Role.Coach
                      : CoachNotification.Role.Admin,
                  recipientTelegramId: TelegramId.make(row.recipient_telegram_id),
                  workspaceName: row.workspace_name,
                  botUsername: row.bot_username,
                  coachLanguage: row.coach_language,
                  attemptCount: row.attempt_count,
                } satisfies PendingNotification,
              ],
        )
      },
    )

    const markNotificationDelivered = Effect.fn(
      "CoachBotProvisioningRepo.markNotificationDelivered",
    )(function* (id: string, now: Date) {
      yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.coachBotNotification)
            .set({ status: "delivered", deliveredAt: now, updatedAt: now })
            .where(eq(schema.coachBotNotification.id, id)),
        catch: (cause) => new QueryFailed({ operation: "notification.delivered", cause }),
      })
    })

    const deferNotification = Effect.fn("CoachBotProvisioningRepo.deferNotification")(function* (
      id: string,
      now: Date,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ attemptCount: schema.coachBotNotification.attemptCount })
            .from(schema.coachBotNotification)
            .where(eq(schema.coachBotNotification.id, id))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "notification.defer.load", cause }),
      })
      const attemptCount = rows[0]?.attemptCount ?? 1
      yield* Effect.tryPromise({
        try: () =>
          client
            .update(schema.coachBotNotification)
            .set({
              availableAt: nextAttemptAt(now, attemptCount),
              updatedAt: now,
            })
            .where(eq(schema.coachBotNotification.id, id)),
        catch: (cause) => new QueryFailed({ operation: "notification.defer", cause }),
      })
    })

    return Service.of({
      prepare,
      claim,
      recordPrompt,
      ingestCandidate,
      findCandidateByBotId,
      complete,
      reopenForRelink,
      findByBotId,
      findInFlightManagedAttempt,
      findByWorkspace,
      workspaceProfile,
      rotate,
      pendingNotifications,
      markNotificationDelivered,
      deferNotification,
    })
  }),
)

export * as CoachBotProvisioningRepo from "./coach-bot-provisioning-repo.ts"
