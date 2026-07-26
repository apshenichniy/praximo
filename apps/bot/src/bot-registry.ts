import { CoachBotHealthRepo, CoachBotProvisioningRepo } from "@praximo/db"
import type { WorkspaceId } from "@praximo/domain"
import { BotRegistry, CoachBotCredential } from "@praximo/telegram"
import { Effect, Layer, Result } from "effect"
import { classifyCoachBotFailure, type HealthEnv, repairCoachBot } from "./coach-bot-health.ts"
import { apiFor } from "./provisioning.ts"

/**
 * The live layer for the seam every outbound coach-bot message goes through
 * (#55): resolve the workspace's bot, decrypt its credential, send, and classify
 * what comes back.
 *
 * **Repair is inline here, not only on the sweep.** A 401 met by a send attempts
 * the same `getManagedBotToken` refresh the daily pass does and retries the send
 * once. The sweep alone would be correct and a day late: the first message after
 * a coach's `/revoke` would be lost, which is the one message that proves the
 * channel matters.
 *
 * **Who receives it.** The interface names a workspace and a text and nothing
 * else, so the only recipient it can mean is the workspace's own coach — the
 * bot's other correspondents are clients, and reaching one takes a channel this
 * signature cannot carry. A recipient-bearing operation arrives with the slice
 * that first messages a client.
 */
const makeLayer = (env: HealthEnv, telegramFetch?: typeof globalThis.fetch) =>
  Layer.effect(
    BotRegistry.Service,
    Effect.gen(function* () {
      const health = yield* CoachBotHealthRepo.Service
      const credentials = yield* CoachBotCredential.Service
      // Captured rather than yielded inside `send`: the interface promises an
      // effect with no requirements, and the repair path needs three services.
      const services = yield* Effect.context<
        CoachBotHealthRepo.Service | CoachBotProvisioningRepo.Service | CoachBotCredential.Service
      >()

      /**
       * One attempt through one credential. The category escapes; the cause
       * never does, because for a coach bot it carries the token in its request
       * URL (ADR 0004).
       */
      const attempt = Effect.fn("BotRegistry.attempt")(function* (
        target: CoachBotHealthRepo.HealthTarget,
        chatId: string,
        text: string,
        options?: BotRegistry.SendOptions,
      ) {
        const token = yield* credentials.decrypt(target.encryptedToken).pipe(Effect.result)
        if (Result.isFailure(token)) return "transient" as const
        const api = apiFor(token.success, telegramFetch)
        const sent = yield* Effect.tryPromise({
          try: () =>
            api.sendMessage(chatId, text, {
              ...(options?.parseMode === undefined ? {} : { parse_mode: options.parseMode }),
              ...(options?.button === undefined
                ? {}
                : {
                    reply_markup: {
                      inline_keyboard: [
                        [
                          {
                            text: options.button.text,
                            web_app: { url: options.button.webAppUrl },
                          },
                        ],
                      ],
                    },
                  }),
            }),
          catch: classifyCoachBotFailure,
        }).pipe(Effect.result)
        return Result.isSuccess(sent) ? ("sent" as const) : sent.failure
      })

      /**
       * The workspace's bot, or the reason there is nothing to send through.
       * Read twice per send in the worst case — once to try, once after a
       * repair has replaced the credential underneath it.
       */
      const resolve = Effect.fn("BotRegistry.resolve")(function* (workspace: WorkspaceId) {
        const target = yield* health
          .findTarget(workspace)
          .pipe(
            Effect.mapError(
              () => new BotRegistry.SendFailed({ workspace, reason: "lookup failed" }),
            ),
          )
        return target === undefined
          ? yield* new BotRegistry.SendFailed({ workspace, reason: "no connected bot" })
          : target
      })

      const send = Effect.fn("BotRegistry.send")(function* (
        workspace: WorkspaceId,
        text: string,
        options?: BotRegistry.SendOptions,
      ) {
        const target = yield* resolve(workspace)
        const chatId = target.coachTelegramId
        if (chatId === undefined) {
          return yield* new BotRegistry.SendFailed({ workspace, reason: "no bound coach" })
        }

        const first = yield* attempt(target, chatId, text, options)
        if (first === "sent") return
        if (first === "transient") {
          return yield* new BotRegistry.SendFailed({ workspace, reason: "telegram unavailable" })
        }

        // Telegram no longer accepts the credential. Repair, and give the
        // message the one retry the refresh earns it.
        const repaired = yield* repairCoachBot(env, target, telegramFetch).pipe(
          Effect.provideContext(services),
        )
        if (repaired._tag !== "Repaired") {
          return yield* new BotRegistry.SendFailed({
            workspace,
            reason: repaired._tag === "Unchanged" ? "telegram unavailable" : "bot needs re-link",
          })
        }
        const second = yield* attempt(yield* resolve(workspace), chatId, text, options)
        if (second === "sent") return
        return yield* new BotRegistry.SendFailed({
          workspace,
          reason: second === "transient" ? "telegram unavailable" : "bot needs re-link",
        })
      })

      return BotRegistry.Service.of({ send })
    }),
  )

export const layer = (env: HealthEnv) => makeLayer(env)

/** The same layer over an injected Telegram transport, for tests. */
export const layerWithFetch = (env: HealthEnv, telegramFetch: typeof globalThis.fetch) =>
  makeLayer(env, telegramFetch)
