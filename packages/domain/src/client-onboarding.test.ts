import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { CoachOnboardingInviteCodeAlphabet } from "./coach-onboarding.ts"
import {
  ClientInviteDeliveryKind,
  ClientInviteStartPrefix,
  ClientInviteTokenAlphabet,
  ClientInviteTokenLength,
  ClientInviteTokenPattern,
  ClientInviteTtlMillis,
  ClientInviteWebPath,
  clientInviteStartParameter,
  clientInviteUrl,
  CreateClientInput,
  InviteAttentionWindowMillis,
  inviteNeedsAttention,
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

/**
 * The rule that keeps Today's needs-attention section from becoming a second
 * clients list (#61): the last two days of the window, and everything past it.
 */
describe("needs attention", () => {
  const NOW = new Date("2026-07-26T09:00:00.000Z")
  const inDays = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1_000)

  it("takes an invitation inside its last two days", () => {
    expect(inviteNeedsAttention("invited", inDays(1.5), NOW)).toBe(true)
    expect(inviteNeedsAttention("invited", inDays(2), NOW)).toBe(true)
  })

  it("leaves a freshly sent invitation alone", () => {
    // The common case on a practice a coach has just filled in: five open
    // invitations, none of them a problem yet.
    expect(inviteNeedsAttention("invited", inDays(6), NOW)).toBe(false)
    expect(InviteAttentionWindowMillis).toBe(2 * 24 * 60 * 60 * 1_000)
  })

  it("takes one that has already lapsed, whatever its expiry says", () => {
    expect(inviteNeedsAttention("expired", inDays(-1), NOW)).toBe(true)
    // A reissue stores `expired` on the invitation it replaced, so the column
    // can say expired while its window is still open.
    expect(inviteNeedsAttention("expired", inDays(5), NOW)).toBe(true)
  })

  it("never asks anything of a client who is already in", () => {
    expect(inviteNeedsAttention("accepted", inDays(-9), NOW)).toBe(false)
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

/**
 * The token's second door (#224): the same twelve symbols in a web URL the coach
 * pastes by hand, built here rather than on either screen that shows it.
 */
describe("web invitation URL", () => {
  it("joins the client app's origin with the invitation path", () => {
    expect(clientInviteUrl("https://me.praximo.io", "23456789ABCD")).toBe(
      "https://me.praximo.io/i/23456789ABCD",
    )
    expect(ClientInviteWebPath).toBe("/i/")
  })

  it("tolerates the trailing slashes a configured origin arrives with", () => {
    expect(clientInviteUrl("https://me.praximo.io/", "23456789ABCD")).toBe(
      "https://me.praximo.io/i/23456789ABCD",
    )
    expect(clientInviteUrl("https://me.praximo.io///", "23456789ABCD")).toBe(
      "https://me.praximo.io/i/23456789ABCD",
    )
  })

  /**
   * The same scrubbing `legalUrl` does, for a stronger reason: this link is
   * forwarded to a client, and a query the origin happened to carry would ride
   * into somebody else's chat.
   */
  it("drops whatever query or fragment the origin carried", () => {
    expect(clientInviteUrl("https://me.praximo.io?b=42", "23456789ABCD")).toBe(
      "https://me.praximo.io/i/23456789ABCD",
    )
    expect(clientInviteUrl("https://me.praximo.io/#top", "23456789ABCD")).toBe(
      "https://me.praximo.io/i/23456789ABCD",
    )
  })
})

const decodeKind = Schema.decodeUnknownEffect(ClientInviteDeliveryKind)

describe("ClientInviteDeliveryKind", () => {
  it.effect("accepts the spec's three doors and nothing else", () =>
    Effect.gen(function* () {
      expect(yield* decodeKind("telegram")).toBe("telegram")
      expect(yield* decodeKind("link")).toBe("link")
      // #58's, and modelled here so the column it lands in has one vocabulary.
      expect(yield* decodeKind("email")).toBe("email")
      expect((yield* Effect.result(decodeKind("manual")))._tag).toBe("Failure")
    }),
  )
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
