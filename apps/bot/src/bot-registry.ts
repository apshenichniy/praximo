import { CoachBotHealthRepo, CoachBotProvisioningRepo } from "@praximo/db"
import type { WorkspaceId } from "@praximo/domain"
import { BotRegistry, CoachBotCredential } from "@praximo/telegram"
import type { Api } from "grammy"
import { Effect, Layer, Result } from "effect"
import { classifyCoachBotFailure, type HealthEnv, repairCoachBot } from "./coach-bot-health.ts"
import { apiFor } from "./provisioning.ts"

/**
 * The live layer for the seam every outbound coach-bot operation goes through
 * (#55, #179): resolve the workspace's bot, decrypt its credential, call
 * Telegram, and classify what comes back.
 *
 * **Repair is inline here, not only on the sweep.** A 401 met by a call attempts
 * the same `getManagedBotToken` refresh the daily pass does and retries once. The
 * sweep alone would be correct and a day late: the first message after a coach's
 * `/revoke` would be lost, which is the one message that proves the channel
 * matters — and the first share after one would be a dead button in a client's
 * chat.
 *
 * **Who it reaches.** Both operations name a workspace and nothing else, so the
 * only Telegram identity they can mean is the workspace's own coach: the
 * recipient of a push, and the *sender* Telegram binds a prepared card to.
 */

/**
 * Why a call through a coach's bot did not happen. The vocabulary is shared by
 * both operations because the causes are: there is one credential, one bot and
 * one repair behind them.
 */
type Refusal =
  | "lookup failed"
  | "no connected bot"
  | "no bound coach"
  | "telegram unavailable"
  | "bot needs re-link"

/**
 * What one call through one credential settled into. Tagged rather than a bare
 * union with the answer, so an operation whose own result is a string could
 * never be mistaken for a refusal.
 */
type Attempt<A> =
  | { readonly _tag: "Answered"; readonly value: A }
  /** Telegram no longer accepts the credential: `401`/`404`. */
  | { readonly _tag: "Refused" }
  | { readonly _tag: "Transient" }

const Refused = { _tag: "Refused" } as const
const Transient = { _tag: "Transient" } as const

const makeLayer = (env: HealthEnv, telegramFetch?: typeof globalThis.fetch) =>
  Layer.effect(
    BotRegistry.Service,
    Effect.gen(function* () {
      const health = yield* CoachBotHealthRepo.Service
      const credentials = yield* CoachBotCredential.Service
      // Captured rather than yielded inside the operations: the interface
      // promises effects with no requirements, and the repair path needs three
      // services.
      const services = yield* Effect.context<
        CoachBotHealthRepo.Service | CoachBotProvisioningRepo.Service | CoachBotCredential.Service
      >()

      /**
       * One attempt through one credential. The category escapes; the cause
       * never does, because for a coach bot it carries the token in its request
       * URL (ADR 0004).
       *
       * Declared rather than wrapped in `Effect.fn`: the operations that call it
       * carry the spans, and a generic here would only earn one back at the cost
       * of casting every branch past `exactOptionalPropertyTypes`.
       */
      const attempt = <A>(
        target: CoachBotHealthRepo.HealthTarget,
        chatId: string,
        call: (api: Api, chatId: string) => Promise<A>,
      ): Effect.Effect<Attempt<A>> =>
        Effect.gen(function* () {
          const token = yield* credentials.decrypt(target.encryptedToken).pipe(Effect.result)
          if (Result.isFailure(token)) return Transient
          const api = apiFor(token.success, telegramFetch)
          const answered = yield* Effect.tryPromise({
            try: () => call(api, chatId),
            catch: classifyCoachBotFailure,
          }).pipe(Effect.result)
          if (Result.isSuccess(answered)) return { _tag: "Answered", value: answered.success }
          return answered.failure === "credential-rejected" ? Refused : Transient
        })

      /**
       * The workspace's bot, or the reason there is nothing to call through.
       * Read twice per operation in the worst case — once to try, once after a
       * repair has replaced the credential underneath it.
       */
      const resolve = Effect.fn("BotRegistry.resolve")(function* (workspace: WorkspaceId) {
        const target = yield* health
          .findTarget(workspace)
          .pipe(Effect.mapError((): Refusal => "lookup failed"))
        return target === undefined ? yield* Effect.fail("no connected bot" as const) : target
      })

      /**
       * Resolve, call, and — on a credential Telegram no longer accepts —
       * repair and give the call the one retry the refresh earns it.
       *
       * Both operations share this because sharing it is the point: a second
       * seam that resolved a bot, decrypted its credential and handled a 401
       * again would be a second place for a refused credential to be handled
       * differently.
       */
      const throughCoachBot = <A>(
        workspace: WorkspaceId,
        call: (api: Api, chatId: string) => Promise<A>,
      ): Effect.Effect<A, Refusal> =>
        Effect.gen(function* () {
          const target = yield* resolve(workspace)
          const chatId = target.coachTelegramId
          if (chatId === undefined) return yield* Effect.fail("no bound coach" as const)

          const first = yield* attempt(target, chatId, call)
          if (first._tag === "Answered") return first.value
          if (first._tag === "Transient") {
            return yield* Effect.fail("telegram unavailable" as const)
          }

          // Telegram no longer accepts the credential. Repair, and give the call
          // the one retry the refresh earns it.
          const repaired = yield* repairCoachBot(env, target, telegramFetch).pipe(
            Effect.provideContext(services),
          )
          if (repaired._tag !== "Repaired") {
            return yield* Effect.fail(
              repaired._tag === "Unchanged"
                ? ("telegram unavailable" as const)
                : ("bot needs re-link" as const),
            )
          }
          const second = yield* attempt(yield* resolve(workspace), chatId, call)
          if (second._tag === "Answered") return second.value
          return yield* Effect.fail(
            second._tag === "Transient"
              ? ("telegram unavailable" as const)
              : ("bot needs re-link" as const),
          )
        })

      const send = Effect.fn("BotRegistry.send")(function* (
        workspace: WorkspaceId,
        text: string,
        options?: BotRegistry.SendOptions,
      ) {
        yield* throughCoachBot(workspace, (api, chatId) =>
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
        ).pipe(Effect.mapError((reason) => new BotRegistry.SendFailed({ workspace, reason })))
      })

      /**
       * The card the coach hands to Telegram's chat picker (#179).
       *
       * The coach is both the `user_id` the prepared message is bound to and the
       * one who will send it, so `allow_user_chats` alone is what the target
       * needs: a private chat with one client.
       *
       * The button is a `url` deep link into this same bot — `web_app` buttons
       * are not allowed in inline messages, and the client is being handed a door
       * into the coach's assistant rather than into an app.
       */
      const prepareCard = Effect.fn("BotRegistry.prepareCard")(function* (
        workspace: WorkspaceId,
        card: BotRegistry.InviteCard,
      ) {
        const prepared = yield* throughCoachBot(workspace, (api, chatId) =>
          api.savePreparedInlineMessage(
            Number(chatId),
            {
              type: "article",
              id: "client-invite",
              title: card.title,
              input_message_content: { message_text: card.text },
              reply_markup: {
                inline_keyboard: [[{ text: card.buttonText, url: card.buttonUrl }]],
              },
            },
            { allow_user_chats: true },
          ),
        ).pipe(Effect.mapError((reason) => new BotRegistry.PrepareFailed({ workspace, reason })))

        // Telegram's own window, read rather than assumed: the caller decides
        // from it whether an id is still worth handing to the picker.
        return {
          id: prepared.id,
          expiresAt: new Date(prepared.expiration_date * 1_000),
        } satisfies BotRegistry.PreparedCard
      })

      return BotRegistry.Service.of({ send, prepareCard })
    }),
  )

export const layer = (env: HealthEnv) => makeLayer(env)

/** The same layer over an injected Telegram transport, for tests. */
export const layerWithFetch = (env: HealthEnv, telegramFetch: typeof globalThis.fetch) =>
  makeLayer(env, telegramFetch)
