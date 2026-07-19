import { describe, expect, it } from "@effect/vitest"
import { WorkspaceId } from "@praximo/domain"
import { Effect } from "effect"
import { BotRegistry } from "./bot-registry.ts"

const workspace = WorkspaceId.make("ws_1")

describe("BotRegistry", () => {
  it.effect("records what the test layer was asked to send", () =>
    Effect.gen(function* () {
      const registry = yield* BotRegistry.Service
      yield* registry.send(workspace, "hello")

      const stub = yield* BotRegistry.TestService
      const sent = yield* stub.sent

      expect(sent).toEqual([{ workspace, text: "hello" }])
    }).pipe(Effect.provide(BotRegistry.testLayer)),
  )

  it.effect("the live layer fails rather than pretending it delivered", () =>
    Effect.gen(function* () {
      const registry = yield* BotRegistry.Service
      const error = yield* Effect.flip(registry.send(workspace, "hello"))

      expect(error._tag).toBe("BotRegistry.SendFailed")
      expect(error.workspace).toBe(workspace)
    }).pipe(Effect.provide(BotRegistry.layer)),
  )
})
