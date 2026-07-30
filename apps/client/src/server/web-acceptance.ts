import { ClientAcceptanceRepo } from "@praximo/db"
import {
  ClientName,
  type CoachLanguage,
  narrowCoachLanguage,
  readEmailAddress,
} from "@praximo/domain"
import { clientConsentVersion } from "@praximo/i18n"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"

import type { SessionSummary } from "@/features/invite/session-summary.ts"
import { type WebRefusal, webRefusal } from "@/features/invite/web-refusal.ts"

/**
 * The Acceptance Page's one service (#57): what a token opens, and the single
 * commit that closes it.
 *
 * Both halves live together for the same reason the bot's do — this is a person
 * who is not a participant yet. There is no session, no principal, and nothing
 * to authorize against but the token in the URL.
 */

/** What the page needs to draw the greeting, the form and the consent. */
export interface AcceptanceView {
  readonly kind: "open"
  /**
   * Named on the page, always. The ru/uk consent text says «ваш коуч» rather
   * than declining a proper noun (#222), which only works because the surface
   * around it says whose page this is — so this field is not decoration, it is
   * the other half of that decision.
   */
  readonly coachName: string
  /** Pre-selection, not a choice: the language the coach wrote the invite in. */
  readonly language: CoachLanguage
  /**
   * The address the invitation was emailed to, when it was (#58).
   *
   * A suggestion in exactly the sense the language above is one, and the form
   * leaves it editable. Worth knowing while reading the commit below: this is
   * the only address in the product with evidence behind it — the client
   * demonstrably received mail there, or they would not be on this page — and a
   * client who edits it replaces a working address with an unverified one. The
   * result screen's echo is what catches that, so it stays.
   */
  readonly suggestedEmail?: string
  readonly consentVersion: string
  readonly session?: SessionSummary
  readonly coachTimezone?: string
}

/**
 * A refusal, or the page.
 *
 * `unknown` names nobody and admits nothing — a typo and a token-guessing script
 * get the same answer, so neither learns whether the code exists or whose it is.
 * The other three know the workspace and say who to ask.
 *
 * **Every variant carries a language**, including the ones with nothing to
 * offer. A refusal is the one screen the client never gets to choose a language
 * on — they never reached the page — so it has to arrive in one they read, and
 * the invitation already knows which. `unknown` has no invitation to ask, so it
 * falls back to what the browser said it wanted.
 */
export type AcceptanceOutcome =
  | AcceptanceView
  | { readonly kind: "unknown"; readonly language: CoachLanguage }
  | {
      readonly kind: WebRefusal
      readonly coachName: string
      readonly language: CoachLanguage
    }

export interface AcceptInput {
  readonly token: string
  readonly name: string
  readonly email: string
  readonly language: CoachLanguage
  readonly googleSub?: string
}

/**
 * The commit's answer.
 *
 * `stale` is what a client sees when the invitation stopped being acceptable
 * between opening the page and pressing the button — the coach reissued, or the
 * same person walked through on Telegram in another tab. It is separate from
 * `invalid` because the remedy differs: one is "ask for a new link", the other
 * is "fix this field".
 */
export type AcceptOutcome =
  | { readonly kind: "accepted"; readonly view: ConfirmationView }
  | { readonly kind: "invalid"; readonly field: "name" | "email" }
  | { readonly kind: "stale" }

export interface ConfirmationView {
  readonly coachName: string
  /**
   * Echoed back on the result screen so a typo is catchable while the client is
   * still looking at the page. This is the whole of the email verification in
   * MVP: not double entry, which people defeat with paste, and not a magic link,
   * which would make acceptance two-legged and destroy the atomicity the design
   * is built on.
   */
  readonly email: string
  readonly session?: SessionSummary
  readonly coachTimezone?: string
}

export interface Interface {
  /**
   * `fallbackLanguage` is what an *unknown* token answers in — read from the
   * browser's `Accept-Language`, because there is no invitation to ask and a
   * refusal in a language the reader does not have is worse than useless.
   */
  readonly open: (
    token: string,
    fallbackLanguage: CoachLanguage,
  ) => Effect.Effect<AcceptanceOutcome>
  readonly accept: (input: AcceptInput) => Effect.Effect<AcceptOutcome>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/client/WebAcceptance",
) {}

const readName = (value: string): string | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ClientName)(value))

const identifier = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`

/**
 * The optional halves of a lookup, shaped for the wire.
 *
 * Both `open` and `accept` hand the same two facts to their own view, and both
 * have to turn a `Date` into a string on the way — written once so the two
 * cannot drift into disagreeing about a meeting they are describing from the
 * same row.
 */
const sessionDetails = (
  lookup: ClientAcceptanceRepo.InviteLookup,
): {
  readonly session?: SessionSummary
  readonly coachTimezone?: string
} => ({
  ...(lookup.coachTimezone === undefined ? {} : { coachTimezone: lookup.coachTimezone }),
  ...(lookup.nextSession === undefined
    ? {}
    : {
        session: {
          scheduledAt: lookup.nextSession.scheduledAt.toISOString(),
          durationMinutes: lookup.nextSession.durationMinutes,
          kind: lookup.nextSession.kind,
        },
      }),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repo = yield* ClientAcceptanceRepo.Service

    /**
     * Reading the invitation never writes, and never fails loudly: a repository
     * error becomes `unknown` rather than a stack trace on a page a client was
     * handed. They cannot act on the difference, and the page that admits least
     * is the one that leaks least.
     */
    const open = Effect.fn("WebAcceptance.open")(function* (
      token: string,
      fallbackLanguage: CoachLanguage,
    ) {
      const lookup = yield* repo.findByWebToken(token).pipe(Effect.orElseSucceed(() => undefined))
      if (lookup === undefined) return { kind: "unknown", language: fallbackLanguage } as const

      const now = new Date(yield* Clock.currentTimeMillis)
      const refusal = webRefusal({
        status: lookup.status,
        expiresAt: lookup.expiresAt,
        now,
      })
      if (refusal !== undefined) {
        // The invitation's language, not the browser's: the coach chose it on
        // this client's behalf and it is the language the link itself was
        // written in, so it is the better guess about who is holding it.
        return {
          kind: refusal,
          coachName: lookup.coachName,
          language: lookup.inviteLanguage,
        } as const
      }

      return {
        kind: "open",
        coachName: lookup.coachName,
        language: lookup.inviteLanguage,
        ...(lookup.inviteAddress === undefined ? {} : { suggestedEmail: lookup.inviteAddress }),
        consentVersion: clientConsentVersion(lookup.inviteLanguage),
        ...sessionDetails(lookup),
      } as const satisfies AcceptanceView
    })

    /**
     * The commit, and the first moment anything is written.
     *
     * The invitation is re-read here rather than trusted from the page's payload:
     * between the render and the press, the coach may have reissued the link or
     * the same person may have walked through on Telegram in another tab. The
     * database is the arbiter either way — `acceptFromWeb` is gated on
     * `status = 'pending'` — so this read is about which *sentence* the client
     * gets, not about whether the write is safe.
     *
     * The recorded version comes from the locale, not from the client: it is a
     * pure function of the language shown, so agreement with the bot's record
     * holds by construction as long as nobody re-authors the catalogue.
     */
    const accept = Effect.fn("WebAcceptance.accept")(function* (input: AcceptInput) {
      const name = readName(input.name)
      if (name === undefined) return { kind: "invalid", field: "name" } as const
      const email = readEmailAddress(input.email)
      if (email === undefined) return { kind: "invalid", field: "email" } as const

      const lookup = yield* repo
        .findByWebToken(input.token)
        .pipe(Effect.orElseSucceed(() => undefined))
      if (lookup === undefined) return { kind: "stale" } as const

      const now = new Date(yield* Clock.currentTimeMillis)
      if (webRefusal({ status: lookup.status, expiresAt: lookup.expiresAt, now }) !== undefined) {
        return { kind: "stale" } as const
      }

      // Narrowed rather than trusted: the language arrives from a form field, and
      // an unrecognised one would otherwise reach `clientConsentVersion` and be
      // recorded as the language somebody agreed in. `narrowCoachLanguage` is
      // total and the identity on a valid value, so it needs no guard in front.
      const language = narrowCoachLanguage(input.language)

      const outcome = yield* repo
        .acceptFromWeb({
          inviteId: lookup.inviteId,
          workspaceId: lookup.workspaceId,
          clientId: lookup.clientId,
          clientName: name,
          email,
          ...(input.googleSub === undefined ? {} : { googleSub: input.googleSub }),
          language,
          consentTextVersion: clientConsentVersion(language),
          channelId: identifier("ch"),
          consentId: identifier("cg"),
          now,
        })
        .pipe(Effect.orElseSucceed(() => ({ accepted: false })))

      if (!outcome.accepted) return { kind: "stale" } as const

      return {
        kind: "accepted",
        view: {
          coachName: lookup.coachName,
          email,
          ...sessionDetails(lookup),
        },
      } as const
    })

    return Service.of({ open, accept })
  }),
)

export * as WebAcceptance from "./web-acceptance.ts"
