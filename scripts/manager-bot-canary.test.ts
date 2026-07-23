import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TelegramId } from "../packages/domain/src/index.ts"
import { ManagerBotSender } from "../packages/telegram/src/manager-bot-sender.ts"
import { runManagerBotCanaryCli, sendManagerBotCanary } from "./manager-bot-canary.ts"

describe("manager-bot canary", () => {
  it.effect("sends only to the first configured admin", () =>
    Effect.gen(function* () {
      yield* sendManagerBotCanary("dev_apshenichniy", "111, 222")

      const stub = yield* ManagerBotSender.TestService
      expect(yield* stub.sent()).toEqual([
        {
          recipient: "111",
          text: "Praximo manager-bot canary: delivery is working.",
        },
      ])
    }).pipe(Effect.provide(ManagerBotSender.testLayer)),
  )

  it.effect("sanitizes CLI output when delivery fails", () =>
    Effect.gen(function* () {
      const output: Array<string> = []
      const recipient = TelegramId.make("111")
      const message = "Praximo manager-bot canary: delivery is working."
      const program = Effect.gen(function* () {
        const stub = yield* ManagerBotSender.TestService
        yield* stub.failNextSend(
          new ManagerBotSender.SendFailed({
            recipient,
            category: "transport",
          }),
        )
        yield* sendManagerBotCanary("dev_apshenichniy", recipient)
      }).pipe(Effect.provide(ManagerBotSender.testLayer))

      const exitCode = yield* Effect.promise(() =>
        runManagerBotCanaryCli(program, {
          log: (line) => output.push(line),
          error: (line) => output.push(line),
        }),
      )

      expect(exitCode).toBe(1)
      expect(output.join("\n")).not.toContain(recipient)
      expect(output.join("\n")).not.toContain(message)
      expect(output.join("\n")).not.toContain("test-token")
    }),
  )
})
