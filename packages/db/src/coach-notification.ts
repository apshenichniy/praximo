import { type SQL, sql } from "drizzle-orm"

/**
 * The conventions `coach_bot_notification` rows are composed by, in one place
 * because two repositories write that table: `CoachBotProvisioningRepo` enqueues
 * `bot_connected` inside bot activation, and `MemberRepo` enqueues
 * `onboarding_complete` inside terms acceptance. Both do it from inside a single
 * statement's CTE — the neon-http driver has no interactive transactions
 * (`client.ts`) — so the composers are SQL expressions over a workspace-id
 * expression rather than string helpers over a JavaScript value.
 *
 * Open set on purpose: a new push must be addable without a migration.
 */
export const Kind = {
  /** The coach's bot finished provisioning. Once per workspace, forever. */
  BotConnected: "bot_connected",
  /** The coach accepted the terms — onboarding is done. Once per workspace. */
  OnboardingComplete: "onboarding_complete",
} as const

export type Kind = (typeof Kind)[keyof typeof Kind]

/**
 * What `on conflict` is inferred against. Composed by the caller rather than
 * enforced as `unique (workspace_id, kind)` because how much recurrence a kind
 * allows is the kind's own decision: `bot_connected` is once forever, while a
 * re-link warning (#55) recurs per episode and would be swallowed by a key that
 * cannot carry the episode.
 */
export const dedupeKey = (kind: Kind, workspaceId: SQL): SQL =>
  sql`${kind} || ':' || ${workspaceId}`

/**
 * The row's primary key. It must be a function of the dedupe key and not of the
 * workspace alone: a workspace emits several kinds, and an id derived from the
 * workspace would collide on the primary key — turning the second push into a
 * hard failure, or a silent no-op under an untargeted `on conflict`.
 */
export const id = (kind: Kind, workspaceId: SQL): SQL =>
  sql`'cbn_' || substring(${workspaceId} from 4) || '_' || ${kind}`

export * as CoachNotification from "./coach-notification.ts"
