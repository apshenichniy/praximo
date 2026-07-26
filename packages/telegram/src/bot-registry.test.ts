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
      const sent = yield* stub.sent()

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

  it.effect("fails a card the same way rather than handing back an unusable id", () =>
    Effect.gen(function* () {
      const registry = yield* BotRegistry.Service
      const error = yield* Effect.flip(registry.prepareCard(workspace, card))

      expect(error._tag).toBe("BotRegistry.PrepareFailed")
      expect(error.workspace).toBe(workspace)
    }).pipe(Effect.provide(BotRegistry.layer)),
  )
})

const card: BotRegistry.InviteCard = {
  title: "Anna",
  text: "Anna opens your bot in Telegram and accepts there.",
  buttonText: "Open the invitation",
  buttonUrl: "https://t.me/ada_coach_bot?start=inv_ABCDEFGH2345",
}

/**
 * The RPC layer is what the `web` Worker holds, so its whole job is the boundary:
 * a tagged refusal must come back as a typed failure rather than as a resolved
 * promise the caller then has to inspect.
 */
const rpc = (prepareCoachInviteCard: () => Promise<unknown>) =>
  BotRegistry.rpcLayer({ prepareCoachInviteCard })

describe("BotRegistry over the bot Worker's binding", () => {
  it.effect("reads the id and Telegram's own expiry off the answer", () =>
    Effect.gen(function* () {
      const registry = yield* BotRegistry.Service
      const prepared = yield* registry.prepareCard(workspace, card)

      expect(prepared.id).toBe("prepared-1")
      expect(prepared.expiresAt.toISOString()).toBe("2026-07-26T12:30:00.000Z")
    }).pipe(
      Effect.provide(
        rpc(async () => ({
          _tag: "Prepared",
          id: "prepared-1",
          expiresAtMillis: Date.parse("2026-07-26T12:30:00.000Z"),
        })),
      ),
    ),
  )

  it.effect("turns a refusal from the bot Worker into a typed failure", () =>
    Effect.gen(function* () {
      const registry = yield* BotRegistry.Service
      const error = yield* Effect.flip(registry.prepareCard(workspace, card))

      expect(error._tag).toBe("BotRegistry.PrepareFailed")
      expect(error.reason).toBe("bot needs re-link")
    }).pipe(
      Effect.provide(rpc(async () => ({ _tag: "Failed", workspace, reason: "bot needs re-link" }))),
    ),
  )

  it.effect("fails rather than throwing when the binding itself is unreachable", () =>
    Effect.gen(function* () {
      const registry = yield* BotRegistry.Service
      const error = yield* Effect.flip(registry.prepareCard(workspace, card))

      expect(error.reason).toBe("bot worker unreachable")
    }).pipe(Effect.provide(rpc(() => Promise.reject(new Error("service binding down"))))),
  )
})
