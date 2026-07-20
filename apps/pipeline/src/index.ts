import { Database, WorkspaceRepo } from "@praximo/db"
import { BotRegistry } from "@praximo/telegram"
import { Transcription } from "@praximo/transcription"
import { Deepgram } from "@praximo/transcription/deepgram"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"

/**
 * Session processing: the Cloudflare Workflows definitions, the LiveKit webhook
 * receiver, and the audio-retention cron sweeper (ADR 0001, ADR 0002). None of
 * that exists yet — this entrypoint only proves the layer graph composes and a
 * runtime boots on workerd.
 *
 * The STT provider is chosen here, at wiring time: nothing below
 * `@praximo/transcription/deepgram` knows which provider is in play.
 */
interface Env {
  readonly DATABASE_URL: string
}

// WorkspaceRepo now reads through the real Neon connection (#47); Database
// resolves its `DATABASE_URL` from the app's own ConfigProvider over the Worker
// env (ADR 0002), not the ambient environment.
const AppLive = Layer.mergeAll(
  WorkspaceRepo.layer.pipe(Layer.provide(Database.layer)),
  Deepgram.layer,
  BotRegistry.layer,
)

const runtimeFromEnv = (env: Env) =>
  ManagedRuntime.make(Layer.provide(AppLive, ConfigProvider.layer(ConfigProvider.fromUnknown(env))))

/** Exactly one runtime per Worker entrypoint (ADR 0002), built from `env` once. */
let runtime: ReturnType<typeof runtimeFromEnv> | undefined

const health = Effect.gen(function* () {
  // Resolving each service proves the graph composes. Nothing is invoked: every
  // adapter is deliberately unwired and would fail.
  yield* WorkspaceRepo.Service
  yield* Transcription.Service
  yield* BotRegistry.Service

  return { app: "pipeline", status: "ok" } as const
})

/**
 * The dev-stack health route (#46): proves the deployed Worker booted its
 * runtime and the layer graph resolved on real infrastructure. Every other path
 * 404s until the real LiveKit-webhook routing arrives with the pipeline ticket.
 */
export const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  if (new URL(request.url).pathname !== "/health") return new Response(null, { status: 404 })

  runtime ??= runtimeFromEnv(env)
  return Response.json(await runtime.runPromise(health))
}

export default { fetch: handleRequest } satisfies ExportedHandler<Env>
