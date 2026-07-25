import { CoachBotProvisioningRepo } from "@praximo/db"
import { Effect } from "effect"

/**
 * What a coach bot's own webhook route does with an update that neither the
 * installation nor the ownership handshake could serve (#150).
 *
 * Two answers, and the distinction is about honesty rather than about Telegram:
 * `redeliver` says "this bot is ours and we are not ready", `refuse` says "we
 * cannot serve this at all". Telegram itself makes no distinction — it "will
 * repeat the request and give up after a reasonable amount of attempts" for any
 * non-2xx (Bot API, `setWebhook`) — so nothing here depends on the status code
 * buying a retry that a 401 would not.
 *
 * Since arming the webhook moved after the activation transaction, `redeliver`
 * should be unreachable on the managed path. It is kept as a tripwire: if it
 * fires, an update reached a bot whose installation does not exist yet, and the
 * log line says which bot and which attempt.
 */
export type Refusal =
  | { readonly _tag: "redeliver"; readonly attemptId: string }
  | { readonly _tag: "refuse" }

/**
 * Decide the answer, and say so in the log either way.
 *
 * The logging is the point as much as the answer is: the incident that produced
 * this module had to be reconstructed from database timestamps, because the route
 * dropped the update without a word.
 */
export const refusalFor = Effect.fn("BotWorker.refusalFor")(function* (botId: string) {
  const repo = yield* CoachBotProvisioningRepo.Service
  const attempt = yield* repo.findInFlightManagedAttempt(botId)
  if (attempt === undefined) {
    yield* Effect.logWarning(
      `coach bot ${botId}: update refused — no installation, no authenticated candidate, no attempt in flight`,
    )
    return { _tag: "refuse" } as const
  }
  yield* Effect.logWarning(
    `coach bot ${botId}: update arrived while attempt ${attempt.id} is still configuring (last touched ${attempt.updatedAt.toISOString()}) — asking Telegram to repeat it`,
  )
  return { _tag: "redeliver", attemptId: attempt.id } as const
})

/**
 * The status the route answers with. Kept beside the decision so the two cannot
 * drift, and so the caller has one thing to fall back to when the decision itself
 * cannot be reached: a read that failed is a `redeliver`, because "we do not know
 * yet" is not something to refuse a coach's first message over.
 */
export const refusalStatus = (refusal: Refusal): number =>
  refusal._tag === "redeliver" ? 500 : 401

export const UndecidedRefusalStatus = 500
