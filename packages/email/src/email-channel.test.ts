import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { EmailChannel } from "./email-channel.ts"
import { inviteEmailCopy } from "./invite-email-copy.ts"

const INVITE = {
  to: "anna@example.com",
  locale: "ru",
  coachName: "Олена Пшенична",
  acceptanceUrl: "https://me.praximo.io/i/a1b2c3d4e5f6",
  markUrl: "https://me.praximo.io/brand/praximo-mark.png",
} as const

interface Recorded {
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly html: string
  readonly text: string
}

/** A binding that records, or throws whatever Cloudflare would have thrown. */
const binding = (throws?: unknown) => {
  const calls: Recorded[] = []
  return {
    calls,
    layer: EmailChannel.layer({
      send: async (message) => {
        if (throws !== undefined) throw throws
        calls.push(message)
        return { messageId: "cf-1" }
      },
    }),
  }
}

const cloudflareError = (code: string) => Object.assign(new Error(code), { code })

describe("EmailChannel.sendClientInvite", () => {
  it.effect("sends both parts from the pinned sender, with the locale's subject", () => {
    const fake = binding()
    return Effect.gen(function* () {
      const channel = yield* EmailChannel.Service
      const result = yield* channel.sendClientInvite(INVITE)
      expect(result.messageId).toBe("cf-1")

      const sent = fake.calls[0]
      expect(sent?.from).toBe(EmailChannel.SenderAddress)
      expect(sent?.to).toBe(INVITE.to)
      expect(sent?.subject).toBe(inviteEmailCopy("ru").subject(INVITE.coachName))
      // Both parts, always: a message without text/plain loses ground with part
      // of the filtering estate.
      expect(sent?.html).toContain(INVITE.acceptanceUrl)
      expect(sent?.text).toContain(INVITE.acceptanceUrl)
    }).pipe(Effect.provide(fake.layer))
  })

  // The one failure a coach can act on, and the only one that may ever tell them
  // to retype an address.
  it.effect("reads E_VALIDATION_ERROR as the address being refused", () => {
    const fake = binding(cloudflareError("E_VALIDATION_ERROR"))
    return Effect.gen(function* () {
      const channel = yield* EmailChannel.Service
      const error = yield* Effect.flip(channel.sendClientInvite(INVITE))
      expect(error._tag).toBe("EmailChannel.AddressRejected")
      expect((error as EmailChannel.EmailAddressRejected).address).toBe(INVITE.to)
    }).pipe(Effect.provide(fake.layer))
  })

  // A wiring error, not weather. It reaches the coach as "try again" because
  // there is nothing else they can do — but the log must not say the same thing
  // about a bug that will fail identically forever.
  it.effect("reads E_SENDER_NOT_VERIFIED as a misconfigured sender", () => {
    const fake = binding(cloudflareError("E_SENDER_NOT_VERIFIED"))
    return Effect.gen(function* () {
      const channel = yield* EmailChannel.Service
      const error = yield* Effect.flip(channel.sendClientInvite(INVITE))
      expect(error._tag).toBe("EmailChannel.SenderNotConfigured")
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("reads throttling as a temporary failure", () => {
    const fake = binding(cloudflareError("E_RATE_LIMIT_EXCEEDED"))
    return Effect.gen(function* () {
      const channel = yield* EmailChannel.Service
      const error = yield* Effect.flip(channel.sendClientInvite(INVITE))
      expect(error._tag).toBe("EmailChannel.SendFailed")
      expect((error as EmailChannel.EmailSendFailed).reason).toBe("E_RATE_LIMIT_EXCEEDED")
    }).pipe(Effect.provide(fake.layer))
  })

  // An unrecognised shape is not evidence the address was bad. Telling a coach
  // to fix an address that was fine is worse than telling them to wait.
  it.effect("treats an error with no code as weather rather than a bad address", () => {
    const fake = binding(new Error("socket hang up"))
    return Effect.gen(function* () {
      const channel = yield* EmailChannel.Service
      const error = yield* Effect.flip(channel.sendClientInvite(INVITE))
      expect(error._tag).toBe("EmailChannel.SendFailed")
    }).pipe(Effect.provide(fake.layer))
  })
})

describe("EmailChannel.testLayer", () => {
  it.effect("records what it rendered, so a caller can assert on the words", () =>
    Effect.gen(function* () {
      const channel = yield* EmailChannel.Service
      yield* channel.sendClientInvite(INVITE)
      const test = yield* EmailChannel.TestService
      const sent = yield* test.sent()
      expect(sent).toHaveLength(1)
      expect(sent[0]?.to).toBe(INVITE.to)
      expect(sent[0]?.subject).toBe(inviteEmailCopy("ru").subject(INVITE.coachName))
      // Rendering is not stubbed on purpose: a caller's test that never
      // exercised the template would keep passing through a template that throws.
      expect(sent[0]?.html).toContain(INVITE.acceptanceUrl)
    }).pipe(Effect.provide(EmailChannel.testLayer)),
  )

  it.effect("fails the next send once when armed, so 'nothing was written' is provable", () =>
    Effect.gen(function* () {
      const test = yield* EmailChannel.TestService
      yield* test.failNextSend(
        new EmailChannel.EmailSendFailed({ reason: "E_RATE_LIMIT_EXCEEDED" }),
      )

      const channel = yield* EmailChannel.Service
      const error = yield* Effect.flip(channel.sendClientInvite(INVITE))
      expect(error._tag).toBe("EmailChannel.SendFailed")
      expect(yield* test.sent()).toHaveLength(0)

      yield* channel.sendClientInvite(INVITE)
      expect(yield* test.sent()).toHaveLength(1)
    }).pipe(Effect.provide(EmailChannel.testLayer)),
  )
})
