import { type SQL, sql } from "drizzle-orm"

/**
 * The conventions `coach_bot_notification` rows are composed by, in one place
 * because three repositories write that table: `CoachBotProvisioningRepo`
 * enqueues `bot_connected` and `relink_completed` inside bot activation,
 * `MemberRepo` enqueues `onboarding_complete` inside terms acceptance, and
 * `CoachBotHealthRepo` enqueues the re-link pair inside the flip. All do it from
 * inside a single statement's CTE — the neon-http driver has no interactive
 * transactions (`client.ts`) — so the composers are SQL expressions over SQL
 * fragments rather than string helpers over JavaScript values.
 *
 * Open set on purpose: a new push must be addable without a migration.
 */
export const Kind = {
  /** The coach's bot finished provisioning. Once per workspace, forever. */
  BotConnected: "bot_connected",
  /** The coach accepted the terms — onboarding is done. Once per workspace. */
  OnboardingComplete: "onboarding_complete",
  /**
   * A coach bot whose credential Telegram had stopped accepting was refreshed
   * from the manager's own management rights, with no outage anybody had to act
   * on (#55). Coach-facing only, once per episode: an admin does not need to
   * hear about a repair that cost nothing.
   */
  BotRepaired: "bot_repaired",
  /** The bot is beyond repair and the coach has to re-link. Coach and admin. */
  NeedsRelink: "needs_relink",
  /** A re-linked workspace is back online. Admin only — the coach was there. */
  RelinkCompleted: "relink_completed",
  /**
   * A client accepted their invitation (#56). Coach-facing, once per client:
   * acceptance is the one event in the whole onboarding that happens without
   * the coach in the room, so it is the one they cannot infer from having done
   * something themselves.
   */
  ClientAccepted: "client_accepted",
} as const

export type Kind = (typeof Kind)[keyof typeof Kind]

/**
 * Which vocabulary the delivery loop reaches for. It cannot be derived from the
 * kind — `needs_relink` queues one row for each — and the recipient id does not
 * say either, so it rides on the row (#55).
 */
export const Role = {
  /** The invite issuer. English, composed beside the delivery loop. */
  Admin: "admin",
  /** The workspace owner. The tri-lingual catalog, in their chosen language. */
  Coach: "coach",
} as const

export type Role = (typeof Role)[keyof typeof Role]

/**
 * What `on conflict` is inferred against. Composed by the caller rather than
 * enforced as `unique (workspace_id, kind)` because how much recurrence a kind
 * allows is the kind's own decision: `bot_connected` is once forever, while the
 * re-link pair recurs per episode and per recipient, and would be swallowed by
 * a key that cannot carry either.
 */
export const dedupeKey = (kind: Kind, workspaceId: SQL, ...parts: ReadonlyArray<SQL>): SQL =>
  parts.reduce((key, part) => sql`${key} || ':' || ${part}`, sql`${kind} || ':' || ${workspaceId}`)

/**
 * The row's primary key. It must be a function of the whole dedupe key and not
 * of the workspace alone: a workspace emits several kinds, and an id derived
 * from the workspace would collide on the primary key — turning the second push
 * into a hard failure, or a silent no-op under an untargeted `on conflict`.
 */
export const id = (kind: Kind, workspaceId: SQL, ...parts: ReadonlyArray<SQL>): SQL =>
  parts.reduce(
    (key, part) => sql`${key} || '_' || ${part}`,
    sql`'cbn_' || substring(${workspaceId} from 4) || '_' || ${kind}`,
  )

export * as CoachNotification from "./coach-notification.ts"
