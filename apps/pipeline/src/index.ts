import { WorkspaceRepo } from "@praximo/db"
import { BotRegistry } from "@praximo/telegram"
import { Transcription } from "@praximo/transcription"
import { Deepgram } from "@praximo/transcription/deepgram"
import { Effect, Layer, ManagedRuntime } from "effect"

/**
 * Session processing: the Cloudflare Workflows definitions, the LiveKit webhook
 * receiver, and the audio-retention cron sweeper (ADR 0001, ADR 0002). None of
 * that exists yet — this entrypoint only proves the layer graph composes and a
 * runtime boots on workerd.
 *
 * The STT provider is chosen here, at wiring time: nothing below
 * `@praximo/transcription/deepgram` knows which provider is in play.
 */
const AppLive = Layer.mergeAll(WorkspaceRepo.layer, Deepgram.layer, BotRegistry.layer)

/**
 * Exactly one runtime per Worker entrypoint (ADR 0002). Once the apps read their
 * environment through Effect `Config`, this moves behind a per-request runtime
 * built from `env` (ADR 0001).
 */
const runtime = ManagedRuntime.make(AppLive)

const health = Effect.gen(function* () {
  // Resolving each service proves the graph composes. Nothing is invoked: every
  // adapter is deliberately unwired and would fail.
  yield* WorkspaceRepo.Service
  yield* Transcription.Service
  yield* BotRegistry.Service

  return { app: "pipeline", status: "ok" } as const
})

export const handleRequest = async (): Promise<Response> =>
  Response.json(await runtime.runPromise(health))

export default { fetch: handleRequest } satisfies ExportedHandler
