import type { CoachLanguage } from "@praximo/domain"
import { render, toPlainText } from "@react-email/render"
import { Context, Effect, Layer, Option, Ref, Schema } from "effect"

import { inviteEmailCopy } from "./invite-email-copy.ts"
import { InviteEmail } from "./invite-email.tsx"

/**
 * Sending email, and every template the product sends (#58).
 *
 * The mirror of `@praximo/telegram`: one package owning a delivery mechanism,
 * exporting service tags and layers and never a runtime (ADR 0002). It owns the
 * words as well as the wire, because unlike the bot — whose words the bot says —
 * the email **is** the surface.
 *
 * **One operation per email the product sends**, rather than a generic
 * `send(html, text)`. A generic sender would push rendering back into the app,
 * which would then own the template, the locale and the subject line — and #41's
 * reminder emails would own a second copy of all three from a different Worker.
 * The seam the app sees is «send this client their invitation»; everything
 * between that sentence and Cloudflare stays behind it.
 */

/**
 * The `send_email` binding, structurally.
 *
 * Declared here rather than imported from `@cloudflare/workers-types` for the
 * same reason `apps/client`'s `Limiter` is: the package should not depend on the
 * runtime it happens to deploy to, and a two-line interface is a test double
 * anybody can write. Only the fields this package sends are named.
 */
export interface SendBinding {
  readonly send: (message: {
    readonly from: string
    readonly to: string
    readonly subject: string
    readonly html: string
    readonly text: string
  }) => Promise<{ readonly messageId?: string }>
}

/**
 * The address every product email is sent from.
 *
 * A constant rather than configuration: it is pinned in `alchemy.run.ts` as the
 * binding's `allowedSenderAddresses`, so a second value here would not send —
 * it would fail at Cloudflare with `E_SENDER_NOT_VERIFIED`.
 */
export const SenderAddress = "no-reply@mail.praximo.io"

/** Cloudflare's own error codes, as far as this package distinguishes them. */
const ValidationCode = "E_VALIDATION_ERROR"
const SenderNotVerifiedCode = "E_SENDER_NOT_VERIFIED"

/**
 * The address was refused at the API boundary — nothing was sent and nothing
 * was charged. The one failure a coach can actually act on: retype it.
 */
export class EmailAddressRejected extends Schema.TaggedErrorClass<EmailAddressRejected>()(
  "EmailChannel.AddressRejected",
  { address: Schema.String },
) {}

/**
 * The sender is not the one the account onboarded — a deployment bug, not a
 * coach's mistake and not a retry.
 *
 * Distinguished from {@link EmailSendFailed} even though both reach the coach as
 * "try again in a moment", because they are opposite facts in a log: one is
 * weather, the other is a wiring error that will fail identically forever.
 */
export class EmailSenderNotConfigured extends Schema.TaggedErrorClass<EmailSenderNotConfigured>()(
  "EmailChannel.SenderNotConfigured",
  { sender: Schema.String },
) {}

/**
 * Everything else: throttling, an outage, a rendering failure. Retryable in the
 * only sense that matters here — pressing the button again is safe, because
 * nothing has been written.
 */
export class EmailSendFailed extends Schema.TaggedErrorClass<EmailSendFailed>()(
  "EmailChannel.SendFailed",
  { reason: Schema.String },
) {}

export type EmailFailure = EmailAddressRejected | EmailSenderNotConfigured | EmailSendFailed

export interface ClientInviteEmail {
  readonly to: string
  readonly locale: CoachLanguage
  /** Nominative, and never inflected into the sentence (#222). */
  readonly coachName: string
  /** The Acceptance Page URL — this email is the Link door's other transport. */
  readonly acceptanceUrl: string
  /** Absolute URL of the brand PNG; Gmail strips SVG, so the mark travels as one. */
  readonly markUrl: string
}

export interface Interface {
  readonly sendClientInvite: (
    input: ClientInviteEmail,
  ) => Effect.Effect<{ readonly messageId?: string }, EmailFailure>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/email/EmailChannel") {}

/**
 * Which failure a thrown Cloudflare error is.
 *
 * Read off `.code` when there is one and treated as weather when there is not:
 * an unrecognised shape is not evidence that the address was bad, and telling a
 * coach to fix an address that was fine is worse than telling them to wait.
 */
const failureOf = (cause: unknown, address: string): EmailFailure => {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String((cause as { readonly code: unknown }).code)
      : undefined
  if (code === ValidationCode) return new EmailAddressRejected({ address })
  if (code === SenderNotVerifiedCode) {
    return new EmailSenderNotConfigured({ sender: SenderAddress })
  }
  return new EmailSendFailed({ reason: code ?? "unknown" })
}

const renderInvite = (input: ClientInviteEmail) =>
  Effect.tryPromise({
    try: async () => {
      const element = InviteEmail({
        locale: input.locale,
        coachName: input.coachName,
        acceptanceUrl: input.acceptanceUrl,
        markUrl: input.markUrl,
      })
      // Both parts, always. A message without `text/plain` loses ground with
      // part of the filtering estate, and `toPlainText` derives it from the same
      // tree rather than from a second hand-kept copy that could disagree.
      const html = await render(element)
      return { html, text: toPlainText(html) }
    },
    catch: (cause) =>
      new EmailSendFailed({ reason: cause instanceof Error ? cause.message : "render failed" }),
  })

export const layer = (binding: SendBinding): Layer.Layer<Service> =>
  Layer.succeed(
    Service,
    Service.of({
      sendClientInvite: Effect.fn("EmailChannel.sendClientInvite")(function* (
        input: ClientInviteEmail,
      ) {
        const { html, text } = yield* renderInvite(input)
        const copy = inviteEmailCopy(input.locale)
        return yield* Effect.tryPromise({
          try: () =>
            binding.send({
              from: SenderAddress,
              to: input.to,
              subject: copy.subject(input.coachName),
              html,
              text,
            }),
          catch: (cause) => failureOf(cause, input.to),
        })
      }),
    }),
  )

/**
 * No binding at all — `vite dev` is not workerd and has none to offer.
 *
 * Fails loudly rather than pretending to work (AGENTS.md): a layer that logged
 * the email and answered success would let a coach's screen say «отправлено»
 * about a message that never existed, which is the exact fiction #224 spent a
 * ticket removing. The consequence, stated: the invitation email cannot be
 * exercised locally, only on a deployed stage.
 */
export const unwiredLayer: Layer.Layer<Service> = Layer.succeed(
  Service,
  Service.of({
    sendClientInvite: Effect.fn("EmailChannel.Unwired.sendClientInvite")(function* () {
      return yield* Effect.fail(new EmailSenderNotConfigured({ sender: SenderAddress }))
    }),
  }),
)

export interface SentInvite extends ClientInviteEmail {
  readonly subject: string
  readonly html: string
  readonly text: string
}

export interface TestInterface extends Interface {
  readonly sent: () => Effect.Effect<ReadonlyArray<SentInvite>>
  /** Arms the next send to fail, so a caller's "nothing was written" is provable. */
  readonly failNextSend: (failure: EmailFailure) => Effect.Effect<void>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@praximo/email/EmailChannel/Test",
) {}

/**
 * Renders for real and sends nowhere.
 *
 * Rendering is deliberately *not* stubbed: a caller's test that never exercises
 * the template would keep passing through a template that throws, and the whole
 * reason the copy lives in this package is that nobody outside it looks at the
 * words.
 */
export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const messages = yield* Ref.make<ReadonlyArray<SentInvite>>([])
    const nextFailure = yield* Ref.make<Option.Option<EmailFailure>>(Option.none())

    const impl = TestService.of({
      sendClientInvite: Effect.fn("EmailChannel.Test.sendClientInvite")(function* (
        input: ClientInviteEmail,
      ) {
        const failure = yield* Ref.getAndSet(nextFailure, Option.none())
        if (Option.isSome(failure)) return yield* Effect.fail(failure.value)
        const { html, text } = yield* renderInvite(input)
        const subject = inviteEmailCopy(input.locale).subject(input.coachName)
        const previous = yield* Ref.getAndUpdate(messages, (sent) => [
          ...sent,
          { ...input, subject, html, text },
        ])
        return { messageId: `test-message-${previous.length}` }
      }),
      sent: () => Ref.get(messages),
      failNextSend: Effect.fn("EmailChannel.Test.failNextSend")((failure: EmailFailure) =>
        Ref.set(nextFailure, Option.some(failure)),
      ),
    })

    return Context.make(Service, impl).pipe(Context.add(TestService, impl))
  }),
)

export * as EmailChannel from "./email-channel.ts"
