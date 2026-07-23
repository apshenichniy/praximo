import { Database, WorkspaceRepo } from "@praximo/db"
import { TelegramId } from "@praximo/domain"
import { BotRegistry, ManagerBotSender } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"

export interface Env {
  readonly DATABASE_URL: string
  readonly MANAGER_BOT_TOKEN: string
}

const AppLive = Layer.mergeAll(
  WorkspaceRepo.layer.pipe(Layer.provide(Database.layer)),
  BotRegistry.layer,
  ManagerBotSender.layer,
)

const runtimeFromEnv = (env: Env) =>
  ManagedRuntime.make(Layer.provide(AppLive, ConfigProvider.layer(ConfigProvider.fromUnknown(env))))

/** Exactly one runtime per Worker isolate (ADR 0002), built from `env` once. */
let runtime: ReturnType<typeof runtimeFromEnv> | undefined

const getRuntime = (env: Env) => (runtime ??= runtimeFromEnv(env))

const health = Effect.gen(function* () {
  yield* WorkspaceRepo.Service
  yield* BotRegistry.Service
  yield* ManagerBotSender.Service

  return { app: "bot", status: "ok" } as const
})

export const sendManagerText = Effect.fn("BotWorker.sendManagerText")(function* (
  recipient: TelegramId,
  text: string,
) {
  const sender = yield* ManagerBotSender.Service

  return yield* sender.sendText(recipient, text).pipe(
    Effect.match({
      onFailure: (failure) =>
        ManagerBotSender.RpcResult.cases.Failed.make({
          recipient: failure.recipient,
          category: failure.category,
        }),
      onSuccess: () => ManagerBotSender.RpcResult.cases.Sent.make({}),
    }),
  )
})

export const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  if (new URL(request.url).pathname !== "/health") {
    return new Response(null, { status: 404 })
  }

  return Response.json(await getRuntime(env).runPromise(health))
}

export const handleManagerTextRpc = (
  env: Env,
  recipient: TelegramId,
  text: string,
): Promise<ManagerBotSender.RpcResult> =>
  getRuntime(env).runPromise(sendManagerText(recipient, text))
