import { Schema } from "effect"

/**
 * A coach bot's connection state, in the domain's own vocabulary.
 *
 * It lives in its own module because two repositories now read the column and
 * neither owns it: `WorkspaceRepo` renders it on the admin surfaces, and
 * `MemberRepo` hands it to the coach's own entry so a coach whose bot has died
 * still gets told so by the one surface that survives it (#55). The mapping
 * below is the single place the storage encoding is translated.
 */
export const BotConnectionStatus = Schema.Literals(["awaiting-setup", "connected", "needs-relink"])
export type BotConnectionStatus = typeof BotConnectionStatus.Type

/**
 * `bot.connection_status` is snake_case in Postgres and kebab-case in the
 * domain; a missing bot row reads as the pre-provisioning state.
 */
export const botConnectionStatus = (value: string | null): BotConnectionStatus =>
  value === null || value === "awaiting_setup"
    ? "awaiting-setup"
    : value === "needs_relink"
      ? "needs-relink"
      : "connected"

export * as BotConnection from "./bot-connection-status.ts"
