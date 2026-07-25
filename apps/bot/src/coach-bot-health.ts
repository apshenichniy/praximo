import { CoachBotHealthRepo, CoachBotProvisioningRepo } from "@praximo/db"
import type { WorkspaceId } from "@praximo/domain"
import { CoachBotCredential } from "@praximo/telegram"
import { GrammyError, HttpError } from "grammy"
import { Clock, Effect, Result } from "effect"
import { apiFor, type ProvisioningEnv, reconfigureCoachBot, sha256 } from "./provisioning.ts"

/**
 * A coach bot that stops answering Telegram is **repaired first, and only
 * flagged when repair is impossible** (#55, ADR 0004 §Token lifecycle).
 *
 * Two facts shape everything here, both verified live on the dev stage on
 * 2026-07-25. Management rights survive the owner's `/revoke`, so
 * `getManagedBotToken` hands back a fresh, immediately working credential for a
 * bot that came through the one-tap path — the coach never learns anything
 * broke. And the stored token does not discriminate: a revoked bot and a deleted
 * one both answer `401`, never `404`, so the stored credential's refusal says
 * only "not ours any more" and `getManagedBotToken` is the sole discriminator
 * between repairable and gone.
 *
 * Discovery is active because it has to be: `ManagedBotUpdated` fires only on
 * creation, and a revoked token stops inbound webhooks too, so a coach bot can
 * be dead in both directions with nothing to notice it by.
 */

export interface HealthEnv extends ProvisioningEnv {
  /**
   * The bot Worker's own public origin — the same value `manager-bot:set-webhook`
   * installs on the manager bot, which is why it travels under that name.
   *
   * The sweep runs on a cron, where there is no inbound request to read an
   * origin off, and a repair re-arms the coach bot's webhook. Optional so a
   * stage that never set it still repairs the credential rather than refusing to:
   * a bot whose token was refreshed can talk again either way, and its webhook is
   * left exactly as Telegram already has it.
   */
  readonly MANAGER_BOT_WEBHOOK_URL?: string
}

/**
 * How often a connected bot is asked whether it still answers. Daily, per ADR
 * 0004: the sweep exists to bound the gap between a revoked token and its
 * discovery, not to notice it within minutes.
 */
export const HEALTH_CHECK_INTERVAL_MILLIS = 24 * 60 * 60 * 1_000

/**
 * How long a bot the sweep could not decide about waits before it is asked
 * again — sooner than the daily pass, because it *is* still an open question,
 * but not on the next tick.
 *
 * Without it the batch starves. `dueForCheck` takes the oldest checks first, so
 * a handful of bots that answer neither yes nor no — a Telegram outage, a
 * credential this Worker cannot open — would hold the whole batch and be
 * re-probed every five minutes while every other bot waited behind them.
 */
export const HEALTH_RETRY_INTERVAL_MILLIS = 60 * 60 * 1_000

/**
 * How many bots one cron tick may probe. The cron fires every five minutes and
 * the batch is taken oldest-check-first, so the pass self-staggers across the
 * day and no tick becomes an unbounded fan-out over Telegram.
 */
export const HEALTH_CHECK_BATCH = 20

/**
 * What a coach bot's own refusal means.
 *
 * `credential-rejected` is `401`/`404` — the pair `coach-bot-release.ts` already
 * reads as "no longer ours". Everything else is treated as transient on purpose:
 * only a definite refusal may start a repair, and a bug of ours or a Telegram
 * hiccup must never be the thing that takes a working bot off its coach.
 *
 * Like every other classifier on this path it keeps the category and drops the
 * cause, which for a coach bot carries its token in the request URL (ADR 0004).
 */
export const classifyCoachBotFailure = (cause: unknown): "credential-rejected" | "transient" =>
  cause instanceof GrammyError && (cause.error_code === 401 || cause.error_code === 404)
    ? "credential-rejected"
    : "transient"

/**
 * What the *manager's* refusal to hand over a fresh credential means.
 *
 * `unrepairable` is the answer this ticket exists for: `403 Forbidden: user is
 * deactivated` for a bot its owner deleted, and `400` for one we never held
 * management rights over — the paste path (#95), where the coach's own
 * @BotFather token is all we ever had. Both are terminal; neither is retryable.
 *
 * **`401` is deliberately not unrepairable.** On this call it is the *manager*
 * bot's own token being refused, which is a platform outage and not a statement
 * about any coach's bot — reading it as "gone" would flip every connected
 * workspace in the sweep over one broken stack secret. It defers, and the caller
 * logs it.
 */
export const classifyManagementFailure = (cause: unknown): "unrepairable" | "transient" => {
  if (cause instanceof HttpError) return "transient"
  if (!(cause instanceof GrammyError)) return "transient"
  if (cause.error_code === 401 || cause.error_code === 429 || cause.error_code >= 500) {
    return "transient"
  }
  return "unrepairable"
}

/** The origin every coach webhook is installed at, when the stage names one. */
export const webhookOriginFrom = (workerUrl: string | undefined): string | undefined => {
  if (workerUrl === undefined || workerUrl.length === 0) return undefined
  try {
    const url = new URL(workerUrl)
    return url.protocol === "https:" ? url.origin : undefined
  } catch {
    return undefined
  }
}

/**
 * What one health decision settled into. Every case is terminal for the update
 * or tick that produced it — `Unchanged` included, which simply leaves the bot
 * where the next tick will find it again.
 */
export type HealthOutcome =
  | { readonly _tag: "Healthy" }
  | { readonly _tag: "Repaired"; readonly username: string }
  | { readonly _tag: "NeedsRelink"; readonly username: string; readonly episode: number }
  /** Somebody else won the conditional flip, or the bot was already flagged. */
  | { readonly _tag: "AlreadyFlagged" }
  /** Nothing was decided: try again on the next tick. */
  | { readonly _tag: "Unchanged"; readonly operation: string }

const unchanged = (operation: string): HealthOutcome => ({ _tag: "Unchanged", operation })

/**
 * Flip one workspace to `needs re-link`, and say what that produced.
 *
 * The transition and both notifications are one conditional statement in the
 * repository, so repeated 401s about the same dead bot cost one update between
 * them and announce the outage exactly once.
 */
const flagNeedsRelink = Effect.fn("BotWorker.flagNeedsRelink")(function* (
  workspaceId: WorkspaceId,
  fallbackUsername: string,
) {
  const health = yield* CoachBotHealthRepo.Service
  const now = new Date(yield* Clock.currentTimeMillis)
  const flip = yield* health.flagNeedsRelink(workspaceId, now).pipe(Effect.result)
  if (Result.isFailure(flip)) {
    yield* Effect.logWarning(
      `coach bot @${fallbackUsername}: could not flag ${workspaceId} as needing a re-link — ${flip.failure.operation}`,
    )
    return unchanged("flagNeedsRelink")
  }
  if (flip.success === undefined) return { _tag: "AlreadyFlagged" } as const
  yield* Effect.logWarning(
    `coach bot @${flip.success.botUsername}: unrepairable, ${workspaceId} now needs a re-link (episode ${flip.success.episode})`,
  )
  return {
    _tag: "NeedsRelink",
    username: flip.success.botUsername,
    episode: flip.success.episode,
  } as const satisfies HealthOutcome
})

/**
 * Ask the manager for a working credential and, if it has one, put the bot back
 * together around it.
 *
 * The whole of configuration runs, not a bare token swap (#55): whether a
 * webhook survives a token change is unverified and now unverifiable, the steps
 * are idempotent, and this costs a handful of calls once in a bot's life. The
 * webhook is armed *before* the row is rewritten, which is the rule every
 * re-configuration on this codebase follows — only the hash of a secret is ever
 * stored, so committing a new hash Telegram has not accepted is what would
 * strand a healthy bot on a secret nothing recognises (ADR 0004).
 *
 * A configuration step that fails leaves the workspace `connected` and returns
 * `Unchanged`: the credential works, so nothing about this is an outage to
 * announce, and the next tick tries again.
 */
export const repairCoachBot = Effect.fn("BotWorker.repairCoachBot")(function* (
  env: HealthEnv,
  target: CoachBotHealthRepo.HealthTarget,
  telegramFetch?: typeof globalThis.fetch,
) {
  const provisioning = yield* CoachBotProvisioningRepo.Service
  const health = yield* CoachBotHealthRepo.Service
  const credentials = yield* CoachBotCredential.Service
  const injectedFetch = telegramFetch === undefined ? {} : { telegramFetch }
  const managerApi = apiFor(env.MANAGER_BOT_TOKEN, telegramFetch)

  const refreshed = yield* Effect.tryPromise({
    try: () => managerApi.getManagedBotToken(Number(target.telegramBotId)),
    catch: classifyManagementFailure,
  }).pipe(Effect.result)

  if (Result.isFailure(refreshed)) {
    if (refreshed.failure === "transient") {
      yield* Effect.logWarning(
        `coach bot @${target.username}: management token refresh deferred — Telegram did not answer for ${target.workspaceId}`,
      )
      return unchanged("getManagedBotToken")
    }
    return yield* flagNeedsRelink(target.workspaceId, target.username)
  }

  const token = refreshed.success
  const origin = webhookOriginFrom(env.MANAGER_BOT_WEBHOOK_URL)
  if (origin === undefined) {
    yield* Effect.logWarning(
      `coach bot @${target.username}: repairing without re-arming its webhook — no public origin is configured for this stage`,
    )
  }
  const configured = yield* reconfigureCoachBot({
    env,
    token,
    botId: target.telegramBotId,
    workspace: target.workspace,
    // No Telegram user travels with a sweep, so the workspace label is the only
    // name available — which is the fallback `coachDisplayName` already takes
    // when a coach has no name of their own.
    coachName: target.workspace.name,
    ...(target.coachTelegramId === undefined ? {} : { coachChatId: target.coachTelegramId }),
    ...(origin === undefined ? {} : { webhookOrigin: origin }),
    ...injectedFetch,
  }).pipe(Effect.result)
  if (Result.isFailure(configured)) {
    yield* Effect.logWarning(
      `coach bot @${target.username}: credential refreshed but reconfiguration failed at ${configured.failure.operation}; leaving ${target.workspaceId} connected`,
    )
    return unchanged(configured.failure.operation)
  }

  const now = new Date(yield* Clock.currentTimeMillis)
  const envelope = yield* credentials.encrypt(token).pipe(Effect.result)
  if (Result.isFailure(envelope)) {
    // The bot works again either way; what failed is our ability to store the
    // credential, which the next tick can retry with the same refresh.
    yield* Effect.logWarning(
      `coach bot @${target.username}: refreshed credential could not be encrypted; ${target.workspaceId} keeps the token it had`,
    )
    return unchanged("encrypt")
  }
  const rotated = yield* provisioning
    .rotate({
      telegramBotId: target.telegramBotId,
      encryptedToken: envelope.success,
      // The fresh secret is only ever recorded once Telegram has accepted it. A
      // stage with no configured origin never armed anything, so the row keeps
      // the hash of the secret Telegram is still presenting.
      webhookSecretHash: configured.success.armed
        ? yield* sha256(configured.success.secret)
        : target.webhookSecretHash,
      botInfo: configured.success.botInfo,
      username: configured.success.botInfo.username,
      now,
    })
    .pipe(Effect.result)
  if (Result.isFailure(rotated)) {
    yield* Effect.logWarning(
      `coach bot @${target.username}: repaired at Telegram but its row was not updated — ${rotated.failure._tag}`,
    )
    return unchanged("rotate")
  }

  // Once per episode, and to the coach alone (#55). The words name the
  // deliberate gesture, because a coach who revoked on purpose will otherwise
  // keep revoking.
  yield* health.queueRepairNotice(target.workspaceId, target.relinkEpisode, now).pipe(
    Effect.tapError((failure) =>
      Effect.logWarning(
        `coach bot @${target.username}: repaired, but the coach was not told — ${failure.operation}`,
      ),
    ),
    Effect.ignore,
  )

  return { _tag: "Repaired", username: rotated.success.username } as const satisfies HealthOutcome
})

/**
 * One bot, one decision: does Telegram still accept the credential we hold, and
 * if not, can the manager hand us a working one?
 *
 * `getMe` is the probe because it is the cheapest call that exercises exactly
 * the thing in question — the token — and touches nothing else about the bot.
 *
 * Every outcome moves `health_checked_at`, including the ones that decided
 * nothing. A repaired or flagged bot is stamped by the write that settled it;
 * an undecided one is stamped *back-dated*, so it falls due again in an hour
 * rather than on the next tick — which is what keeps a handful of unanswerable
 * bots from holding the batch and starving the daily pass.
 */
export const checkCoachBot = Effect.fn("BotWorker.checkCoachBot")(function* (
  env: HealthEnv,
  target: CoachBotHealthRepo.HealthTarget,
  telegramFetch?: typeof globalThis.fetch,
) {
  const health = yield* CoachBotHealthRepo.Service
  const credentials = yield* CoachBotCredential.Service

  /** Back-dated so `dueForCheck`'s own window brings this bot back in an hour. */
  const deferCheck = (): Effect.Effect<void> =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        health.markChecked(
          target.workspaceId,
          new Date(now - HEALTH_CHECK_INTERVAL_MILLIS + HEALTH_RETRY_INTERVAL_MILLIS),
        ),
      ),
      Effect.ignore,
    )

  const token = yield* credentials.decrypt(target.encryptedToken).pipe(Effect.result)
  if (Result.isFailure(token)) {
    // A credential this Worker cannot open says nothing about Telegram, and
    // flagging on it would turn one bad key into an outage for every workspace.
    yield* Effect.logWarning(
      `coach bot @${target.username}: its stored credential could not be decrypted; leaving ${target.workspaceId} alone`,
    )
    yield* deferCheck()
    return unchanged("decrypt")
  }

  const api = apiFor(token.success, telegramFetch)
  const probe = yield* Effect.tryPromise({
    try: () => api.getMe(),
    catch: classifyCoachBotFailure,
  }).pipe(Effect.result)

  if (Result.isSuccess(probe)) {
    const now = new Date(yield* Clock.currentTimeMillis)
    yield* health.markChecked(target.workspaceId, now).pipe(Effect.ignore)
    return { _tag: "Healthy" } as const satisfies HealthOutcome
  }
  if (probe.failure === "transient") {
    yield* deferCheck()
    return unchanged("getMe")
  }

  const repaired = yield* repairCoachBot(env, target, telegramFetch)
  if (repaired._tag === "Unchanged") yield* deferCheck()
  return repaired
})

/**
 * The daily pass, riding the bot Worker's existing five-minute cron.
 *
 * No second cron and no branching on `controller.cron`: the batch is bounded and
 * taken oldest-check-first, so the work spreads itself over the day and a stage
 * with a handful of coaches spends most ticks reading nothing.
 */
export const sweepCoachBotHealth = Effect.fn("BotWorker.sweepCoachBotHealth")(function* (
  env: HealthEnv,
  telegramFetch?: typeof globalThis.fetch,
) {
  const health = yield* CoachBotHealthRepo.Service
  const now = yield* Clock.currentTimeMillis
  const due = yield* health.dueForCheck(
    new Date(now - HEALTH_CHECK_INTERVAL_MILLIS),
    HEALTH_CHECK_BATCH,
  )
  // Serial on purpose: this is background work against per-bot rate limits, and
  // nothing downstream is waiting for it.
  return yield* Effect.forEach(due, (target) => checkCoachBot(env, target, telegramFetch))
})
