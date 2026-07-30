import "@tanstack/react-start/server-only"

import { AvatarRepo, ClientAcceptanceRepo } from "@praximo/db"
import {
  ClientName,
  type CoachLanguage,
  narrowCoachLanguage,
  readEmailAddress,
  WorkspaceId,
} from "@praximo/domain"
import { clientConsentVersion } from "@praximo/i18n"
import { AvatarReader, AvatarStore, type ServedAvatar } from "@praximo/storage"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"

import type { SessionSummary } from "@/features/invite/session-summary.ts"
import { type WebRefusal, webRefusal } from "@/features/invite/web-refusal.ts"
import { GoogleIdentity } from "./google-identity.ts"
import { captureGooglePicture } from "./google-picture.ts"

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
  /**
   * Whether there is a photo of the coach to put beside their name (#231).
   *
   * Presence, never a key: the page renders an `<img>` at a URL keyed by the token
   * it is already at, and the route behind it resolves the object itself. What the
   * flag buys over simply letting that image 404 is the two things a client would
   * otherwise get — a wasted request per view for the many coaches who have no
   * photo, and initials replaced by a picture a beat after the page settled.
   */
  readonly coachHasPhoto: boolean
  /**
   * Whether the page may draw **Continue with Google** (#59).
   *
   * A property of the *origin* this page was served from, not of the invitation:
   * Google matches redirect URIs exactly, so a stage it has not been told about
   * would send the client to `redirect_uri_mismatch` — an error screen on a page
   * their coach handed them. No button is the honest answer there, and it is the
   * same answer a stage with no OAuth client at all gives.
   *
   * Absent rather than disabled, deliberately. A dead control on a legally
   * operative page is the placeholder-reads-as-a-promise failure #57 was built on
   * refusing, and the column is finished without it either way.
   */
  readonly googleAvailable: boolean
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
      /** The refusals that name a coach show their face too — see {@link AcceptanceView}. */
      readonly coachHasPhoto: boolean
    }

/**
 * What a Google import contributes to the commit (#59), and the reason it is not
 * on the page's payload.
 *
 * Both fields are read out of the sealed import cookie server-side. A `sub` the
 * browser could choose would attest to nothing — anyone could claim anyone's —
 * and a picture URL it could choose would be an address a stranger picked for a
 * request this Worker makes. The name and the address the import filled in *are*
 * the page's, because the client can edit them and does.
 */
export interface GoogleImport {
  readonly sub: string
  readonly pictureUrl?: string
}

export interface AcceptInput {
  readonly token: string
  readonly name: string
  readonly email: string
  readonly language: CoachLanguage
  readonly googleImport?: GoogleImport
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
  /** The confirmation shows the coach as well; see {@link AcceptanceView}. */
  readonly coachHasPhoto: boolean
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
    /** Where this page is being served from; see {@link AcceptanceView.googleAvailable}. */
    origin: string,
  ) => Effect.Effect<AcceptanceOutcome>
  readonly accept: (input: AcceptInput) => Effect.Effect<AcceptOutcome>
  /**
   * The coach's photo, for the `<img>` this page renders beside their name (#231).
   *
   * **Keyed by the token, because that is all this surface has.** There is no
   * session and nobody signed in — the whole premise of the page — so the
   * invitation is the authorisation, exactly as it is for `open`. It discloses no
   * more than the page already does, which says whose practice this is in its first
   * sentence, and it answers for a spent or expired invitation too: those screens
   * still name the coach to ask.
   *
   * No R2 key appears in the URL, so "who else can hold this address, and for how
   * long" is a question this design never has to answer — the address is the
   * invitation's, and it dies with it.
   */
  readonly coachPhoto: (token: string, ifNoneMatch: string | null) => Effect.Effect<ServedAvatar>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/client/WebAcceptance",
) {}

const readName = (value: string): string | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ClientName)(value))

/**
 * The workspace the avatar write is scoped by, branded without raising.
 *
 * The value comes out of the row this commit just claimed, so it is a workspace
 * id or nothing is. `make` would throw on the impossible case, and this runs
 * *after* the client has been committed and told so — a defect here would replace
 * their confirmation with an error over a picture nobody asked them for.
 */
const readWorkspaceId = (value: string): WorkspaceId | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(WorkspaceId)(value))

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

/**
 * The transport is a parameter for the reason every other one in this repository
 * is: the Google picture is fetched from inside `accept`, and a suite that could
 * not intercept that would be asserting against the internet.
 */
export const layer = (fetch: typeof globalThis.fetch) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const repo = yield* ClientAcceptanceRepo.Service
      const avatars = yield* AvatarRepo.Service
      const reader = yield* AvatarReader.Service
      const google = yield* GoogleIdentity.Service
      // Acquired here rather than left on `accept`'s context: the operation's own
      // signature is what `runAcceptance` promises this Worker, and a service
      // leaking into it would make every caller provide a bucket to accept an
      // invitation.
      const store = yield* AvatarStore.Service

      /**
       * Reading the invitation never writes, and never fails loudly: a repository
       * error becomes `unknown` rather than a stack trace on a page a client was
       * handed. They cannot act on the difference, and the page that admits least
       * is the one that leaks least.
       */
      const open = Effect.fn("WebAcceptance.open")(function* (
        token: string,
        fallbackLanguage: CoachLanguage,
        origin: string,
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
            coachHasPhoto: lookup.coachHasPhoto,
          } as const
        }

        return {
          kind: "open",
          coachName: lookup.coachName,
          language: lookup.inviteLanguage,
          ...(lookup.inviteAddress === undefined ? {} : { suggestedEmail: lookup.inviteAddress }),
          consentVersion: clientConsentVersion(lookup.inviteLanguage),
          coachHasPhoto: lookup.coachHasPhoto,
          googleAvailable: google.offeredAt(origin),
          ...sessionDetails(lookup),
        } as const satisfies AcceptanceView
      })

      /**
       * The commit, and the first moment anything is written.
       *
       * The invitation is re-read here rather than trusted from the page's payload:
       * between the render and the press, the coach may have reissued the link or
       * the same person may have walked through on Telegram in another tab. The
       * database is the arbiter either way — `claim` is gated on
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
          .claim({
            inviteId: lookup.inviteId,
            workspaceId: lookup.workspaceId,
            clientId: lookup.clientId,
            identity: {
              kind: "email",
              address: email,
              clientName: name,
              ...(input.googleImport === undefined ? {} : { googleSub: input.googleImport.sub }),
            },
            language,
            now,
          })
          .pipe(Effect.orElseSucceed(() => ({ accepted: false })))

        if (!outcome.accepted) return { kind: "stale" } as const

        /**
         * The imported picture, and everything about *when* is deliberate (#59).
         *
         * Past this line the client is committed: the Channel exists, the Consent
         * Grant is appended, the Invite is spent. Storing a photograph of them
         * before that would be processing without a consent, and an abandoned page
         * would have left an object nothing references — so it happens here, after
         * the atomic statement rather than inside it, exactly as the bot's capture
         * does (#231).
         *
         * It cannot fail this operation and it cannot slow it past its own bound.
         * A client whose picture does not arrive keeps the initials that are the
         * specified fallback on every surface, and is told nothing about it,
         * because nothing about it is theirs to act on.
         */
        const workspaceId = readWorkspaceId(lookup.workspaceId)
        if (input.googleImport !== undefined && workspaceId !== undefined) {
          yield* captureGooglePicture({
            workspaceId,
            clientId: lookup.clientId,
            ...(input.googleImport.pictureUrl === undefined
              ? { pictureUrl: undefined }
              : { pictureUrl: input.googleImport.pictureUrl }),
            fetch,
          }).pipe(
            Effect.provideService(AvatarStore.Service, store),
            Effect.provideService(AvatarRepo.Service, avatars),
          )
        }

        return {
          kind: "accepted",
          view: {
            coachName: lookup.coachName,
            coachHasPhoto: lookup.coachHasPhoto,
            email,
            ...sessionDetails(lookup),
          },
        } as const
      })

      /**
       * Reading the photo never fails loudly, for the reason `open` does not: a
       * repository that cannot answer becomes "no photo", the client sees the
       * initials that are the specified fallback anyway, and nothing about a database
       * hiccup reaches a page somebody was handed.
       *
       * The key is resolved here rather than carried on the page's payload — that is
       * what keeps an object key out of the HTML and out of anything a browser could
       * quote back.
       */
      const coachPhoto = Effect.fn("WebAcceptance.coachPhoto")(function* (
        token: string,
        ifNoneMatch: string | null,
      ) {
        const key = yield* avatars
          .coachAvatarKeyForInvite(token)
          .pipe(Effect.orElseSucceed(() => undefined))
        return yield* reader.serve({ key, ifNoneMatch })
      })

      return Service.of({ open, accept, coachPhoto })
    }),
  )

export * as WebAcceptance from "./web-acceptance.ts"
