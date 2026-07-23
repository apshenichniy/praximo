import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ManagerInitData } from "./manager-init-data.ts"

const MANAGER_BOT_TOKEN = "123456789:AAExampleTestToken"

// Fixed, independently calculated Telegram WebAppData vector for:
// auth_date=2026-07-23T12:00:00Z and user id 123456789.
const VALID_INIT_DATA =
  "auth_date=1784808000&query_id=AAEAAAE&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Ada%22%2C%22username%22%3A%22ada_coach%22%7D&hash=e7f020d802315d3769a8d0602381fa7edc6f09807cd4a735b433e05871253e06"

const SIGNED_MALFORMED_USER =
  "auth_date=1784808000&query_id=AAEAAAE&user=%7B%22id%22%3A%22not-a-number%22%2C%22first_name%22%3A%22Ada%22%7D&hash=95b7eda389e03c5a5c05e8322e0f0c2da0d2662742c1e2d82c24bd78a2502fc6"

const testConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({ MANAGER_BOT_TOKEN }))

describe("ManagerInitData", () => {
  it.effect("returns the Telegram id from fresh, authentic manager-bot initData", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const verifier = yield* ManagerInitData.Service

      expect(yield* verifier.verify(VALID_INIT_DATA)).toBe("123456789")
    }).pipe(Effect.provide(ManagerInitData.layer), Effect.provide(testConfig)),
  )

  it.effect("rejects initData with a forged signature", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const verifier = yield* ManagerInitData.Service
      const forged = VALID_INIT_DATA.replace("hash=e7f0", "hash=07f0")
      const error = yield* Effect.flip(verifier.verify(forged))

      expect(error._tag).toBe("ManagerInitData.VerificationFailed")
    }).pipe(Effect.provide(ManagerInitData.layer), Effect.provide(testConfig)),
  )

  it.effect("rejects authentic initData older than 24 hours", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-24T12:00:01.000Z"))
      const verifier = yield* ManagerInitData.Service
      const error = yield* Effect.flip(verifier.verify(VALID_INIT_DATA))

      expect(error._tag).toBe("ManagerInitData.VerificationFailed")
    }).pipe(Effect.provide(ManagerInitData.layer), Effect.provide(testConfig)),
  )

  it.effect("rejects initData dated in the future", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T11:59:59.000Z"))
      const verifier = yield* ManagerInitData.Service
      const error = yield* Effect.flip(verifier.verify(VALID_INIT_DATA))

      expect(error._tag).toBe("ManagerInitData.VerificationFailed")
    }).pipe(Effect.provide(ManagerInitData.layer), Effect.provide(testConfig)),
  )

  it.effect("rejects a signed user payload without a numeric Telegram id", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:01:00.000Z"))
      const verifier = yield* ManagerInitData.Service
      const error = yield* Effect.flip(verifier.verify(SIGNED_MALFORMED_USER))

      expect(error._tag).toBe("ManagerInitData.VerificationFailed")
      expect(JSON.stringify(error)).not.toContain(MANAGER_BOT_TOKEN)
      expect(JSON.stringify(error)).not.toContain("not-a-number")
    }).pipe(Effect.provide(ManagerInitData.layer), Effect.provide(testConfig)),
  )
})
