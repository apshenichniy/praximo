import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { CoachBotCredential } from "./coach-bot-credential.ts"

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const live = CoachBotCredential.layer.pipe(
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromUnknown({ COACH_BOT_CREDENTIAL_KEY: key })),
  ),
)

describe("CoachBotCredential", () => {
  it.effect("round-trips a token through a versioned randomized envelope", () =>
    Effect.gen(function* () {
      const credentials = yield* CoachBotCredential.Service
      const first = yield* credentials.encrypt("123456:telegram-token")
      const second = yield* credentials.encrypt("123456:telegram-token")

      expect(first).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
      expect(second).not.toBe(first)
      expect(yield* credentials.decrypt(first)).toBe("123456:telegram-token")
      expect(yield* credentials.decrypt(second)).toBe("123456:telegram-token")
    }).pipe(Effect.provide(live)),
  )

  it.effect("rejects tampered and unknown envelopes", () =>
    Effect.gen(function* () {
      const credentials = yield* CoachBotCredential.Service
      const encrypted = yield* credentials.encrypt("secret")
      const [version, iv, ciphertext] = encrypted.split(".") as [string, string, string]
      const tampered = `${version}.${iv}.${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`

      expect((yield* Effect.flip(credentials.decrypt(tampered)))._tag).toBe(
        "CoachBotCredential.DecryptionFailed",
      )
      expect((yield* Effect.flip(credentials.decrypt("v2.invalid.envelope")))._tag).toBe(
        "CoachBotCredential.DecryptionFailed",
      )
    }).pipe(Effect.provide(live)),
  )
})
