import { Config, Context, Effect, Layer, Option, Redacted } from "effect"

/**
 * Construction-time dependencies shared by the provisioning, fallback and
 * health paths. Scalar values are decoded through the app's ConfigProvider;
 * only the Cloudflare binding and injectable Telegram transport arrive as
 * concrete values.
 */
export interface Interface {
  readonly managerBotToken: string
  readonly managerBotUsername: string
  readonly managerBotWebhookUrl: string | undefined
  readonly defaultCoachBotAvatarR2Key: string
  readonly coachMiniAppUrl: string
  readonly uploads: R2Bucket
  readonly fetch: typeof globalThis.fetch
}

export class Service extends Context.Service<Service, Interface>()(
  "BotWorker/CoachBotProvisioningRuntime",
) {}

const makeLayer = (uploads: R2Bucket, fetch: typeof globalThis.fetch) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const managerBotToken = Redacted.value(yield* Config.redacted("MANAGER_BOT_TOKEN"))
      const managerBotUsername = yield* Config.string("MANAGER_BOT_USERNAME")
      const managerBotWebhookUrl = Option.getOrUndefined(
        yield* Config.option(Config.string("MANAGER_BOT_WEBHOOK_URL")),
      )
      const defaultCoachBotAvatarR2Key = yield* Config.string("DEFAULT_COACH_BOT_AVATAR_R2_KEY")
      const coachMiniAppUrl = yield* Config.string("COACH_MINI_APP_URL")

      return Service.of({
        managerBotToken,
        managerBotUsername,
        managerBotWebhookUrl,
        defaultCoachBotAvatarR2Key,
        coachMiniAppUrl,
        uploads,
        fetch,
      })
    }),
  )

export const layer = (uploads: R2Bucket) => makeLayer(uploads, globalThis.fetch)

export const testLayer = (uploads: R2Bucket, fetch: typeof globalThis.fetch) =>
  makeLayer(uploads, fetch)

export * as CoachBotProvisioningRuntime from "./coach-bot-provisioning-runtime.ts"
