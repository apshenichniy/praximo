import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { CoachOnboardingInviteCodeAlphabet } from "./coach-onboarding.ts"
import {
  ClientInviteStartPrefix,
  ClientInviteTokenAlphabet,
  ClientInviteTokenLength,
  ClientInviteTokenPattern,
  ClientInviteTtlMillis,
  clientInviteStartParameter,
  CreateClientInput,
  parseClientInviteStartParameter,
} from "./client-onboarding.ts"

describe("client invite token", () => {
  // Same readable alphabet as the coach's code, twice the length: this token has
  // a second door — the web Acceptance Page (#57), where guessing is HTTP and
  // parallel rather than rate-limited by Telegram.
  it("uses the coach alphabet over twelve symbols", () => {
    expect(ClientInviteTokenAlphabet).toBe(CoachOnboardingInviteCodeAlphabet)
    expect(ClientInviteTokenLength).toBe(12)
  })

  it("accepts a well-formed token and refuses everything else", () => {
    expect(ClientInviteTokenPattern.test("23456789ABCD")).toBe(true)
    // Too short, and the ambiguous glyphs the alphabet drops.
    expect(ClientInviteTokenPattern.test("23456789ABC")).toBe(false)
    expect(ClientInviteTokenPattern.test("23456789ABC0")).toBe(false)
    expect(ClientInviteTokenPattern.test("23456789abcd")).toBe(false)
  })

  it("expires seven days out", () => {
    expect(ClientInviteTtlMillis).toBe(7 * 24 * 60 * 60 * 1_000)
  })
})

describe("start parameter", () => {
  it("round-trips a token through the deep link", () => {
    const parameter = clientInviteStartParameter("23456789ABCD")
    expect(parameter).toBe(`${ClientInviteStartPrefix}23456789ABCD`)
    expect(parseClientInviteStartParameter(parameter)).toBe("23456789ABCD")
  })

  // The cheap junk filter in front of the database: anything that cannot be a
  // token is a stranger's `/start`, answered identically and never queried.
  it("refuses a parameter that is not a client invitation", () => {
    expect(parseClientInviteStartParameter("")).toBeUndefined()
    expect(parseClientInviteStartParameter("ws_23456789")).toBeUndefined()
    expect(parseClientInviteStartParameter("inv_")).toBeUndefined()
    expect(parseClientInviteStartParameter("inv_23456789ABC")).toBeUndefined()
    expect(parseClientInviteStartParameter("inv_23456789ABC0")).toBeUndefined()
  })
})

const decode = Schema.decodeUnknownEffect(CreateClientInput)

describe("CreateClientInput", () => {
  it.effect("trims the name and keeps the invitation language", () =>
    Effect.gen(function* () {
      expect(yield* decode({ name: "  Maria K.  ", inviteLanguage: "uk" })).toEqual({
        name: "Maria K.",
        inviteLanguage: "uk",
      })
    }),
  )

  it.effect("refuses a blank name", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(decode({ name: "   ", inviteLanguage: "en" }))
      expect(result._tag).toBe("Failure")
    }),
  )

  it.effect("refuses a language the product does not speak", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(decode({ name: "Maria K.", inviteLanguage: "de" }))
      expect(result._tag).toBe("Failure")
    }),
  )
})
