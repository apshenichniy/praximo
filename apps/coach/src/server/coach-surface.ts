import { CoachOnboardingToken } from "@praximo/auth"
import { MemberRepo } from "@praximo/db"
import { CoachLanguage } from "@praximo/domain"
import { Clock, Config, Context, Effect, Layer, Schema } from "effect"
import { TERMS_VERSION } from "@praximo/i18n"
import { CoachSession, READ_WINDOW_MILLIS, WRITE_WINDOW_MILLIS } from "./coach-session.ts"
import type { LaunchCredential } from "./launch-credential.ts"

/**
 * The one screen a coach is sent to before anything else exists, and the one
 * after. Two states, because in MVP a coach has exactly two: they have accepted
 * the terms or they have not (#38's seam rule — one top-level service per
 * slice).
 *
 * `terms-required` is a state of the entry, not a route: a blocking screen with
 * a URL of its own is a screen that can be bookmarked past.
 */
export type CoachEntry =
  | {
      readonly kind: "terms-required"
      readonly termsVersion: string
      /**
       * Where the full texts are, now that they are not here (#191). The screen
       * summarises the terms in five lines and links out to them, and that link
       * crosses a host — so it comes from the Worker's configuration rather than
       * from a string on the screen, and it travels on the payload the screen
       * already waits for rather than costing a second round trip.
       */
      readonly legalOrigin: string
      /**
       * What the coach is being spoken to in *right now* — seeded from their
       * Telegram client when they claimed the invite (#130). Onboarding's first
       * step shows it back to them and lets them disagree; every word of the
       * screen, the terms included, renders in it.
       */
      readonly language: CoachLanguage
    }
  | {
      readonly kind: "home"
      readonly botUsername: string
      readonly telegramBotId: string
      readonly language: CoachLanguage
      /**
       * Present exactly while the coach's own bot has stopped answering (#55).
       * Nothing about the workspace is blocked by it — the delivery channel is
       * broken, not the data — so it is a banner on the home screen rather than
       * a screen of its own, and it carries the one link that repairs it.
       *
       * That link points at the *manager* bot with a reserved payload: the
       * coach's bot cannot answer, and an existing chat offers no **Start**
       * button for a bare link to press.
       */
      readonly relink?: { readonly link: string }
    }

export interface Interface {
  readonly openApp: (
    credential: LaunchCredential,
  ) => Effect.Effect<CoachEntry, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly acceptTerms: (
    credential: LaunchCredential,
    version: unknown,
  ) => Effect.Effect<
    CoachEntry,
    CoachSession.Unauthenticated | CoachSession.LoadFailed | StaleTermsVersion
  >
  /**
   * The coach's own choice of the language Praximo speaks to them (#130) — the
   * second and last writer of `member.language`.
   *
   * It is deliberately usable before *and* after acceptance. Before, it is
   * onboarding's first step; after, it is what a settings screen would call, and
   * nothing about accepting terms should have to be undone to change a language.
   */
  readonly chooseLanguage: (
    credential: LaunchCredential,
    language: unknown,
  ) => Effect.Effect<
    CoachEntry,
    CoachSession.Unauthenticated | CoachSession.LoadFailed | UnsupportedLanguage
  >
}

export class Service extends Context.Service<Service, Interface>()("@praximo/coach/CoachSurface") {}

/**
 * The screen the coach agreed on is not the text the server would record. The
 * client reloads rather than the server quietly accepting a different document
 * than the one that was read.
 */
export class StaleTermsVersion extends Schema.TaggedErrorClass<StaleTermsVersion>()(
  "CoachSurface.StaleTermsVersion",
  { current: Schema.String },
) {}

/**
 * A language outside the three the product speaks. The Mini App offers exactly
 * those three, so this is a broken client or a hand-made request — but the
 * column is an enum and the refusal belongs here rather than at the database.
 */
export class UnsupportedLanguage extends Schema.TaggedErrorClass<UnsupportedLanguage>()(
  "CoachSurface.UnsupportedLanguage",
  {},
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* CoachSession.Service
    const members = yield* MemberRepo.Service
    const tokens = yield* CoachOnboardingToken.Service
    // Read once, at layer construction: it is a deployment fact, not a per-call
    // one, and a stage that cannot tell a coach where the terms are should fail
    // where that is visible rather than on somebody's onboarding screen.
    const legalOrigin = yield* Config.string("CLIENT_APP_URL")

    /**
     * The home screen for one authenticated coach. It is built in one place
     * because both entry points hand back the same screen, and the re-link
     * banner has to appear on both — a coach whose bot dies between opening the
     * terms and accepting them is still a coach whose bot died.
     */
    const home = Effect.fn("CoachSurface.home")(function* (
      principal: CoachSession.PreOnboardingPrincipal,
    ) {
      return {
        kind: "home",
        botUsername: principal.botUsername,
        telegramBotId: principal.telegramBotId,
        language: principal.language,
        ...(principal.botConnectionStatus === "needs-relink"
          ? { relink: { link: yield* tokens.relinkLink() } }
          : {}),
      } satisfies CoachEntry
    })

    /**
     * The entry, authenticated once. The gate it asks is the weaker one — this
     * screen exists precisely for a coach who has not accepted yet — and
     * `isOnboarded` is what turns that one answer into the two states.
     */
    const openApp = Effect.fn("CoachSurface.openApp")(function* (credential: LaunchCredential) {
      const principal = yield* session.authenticateForTermsAcceptance(
        credential,
        READ_WINDOW_MILLIS,
      )
      if (!CoachSession.isOnboarded(principal)) {
        return {
          kind: "terms-required",
          termsVersion: TERMS_VERSION,
          legalOrigin,
          language: principal.language,
        } satisfies CoachEntry
      }
      return yield* home(principal)
    })

    /**
     * Write the coach's chosen language, then re-read the entry through the same
     * gate that opened it.
     *
     * Re-reading rather than echoing the argument back is what makes the client
     * simple: whichever step the coach is on, the screen renders whatever the
     * database now says, and a write that did not take cannot look like one that
     * did. The window is the write one — this is a state change, and it is made
     * on the first screen of a fresh launch.
     */
    const chooseLanguage = Effect.fn("CoachSurface.chooseLanguage")(function* (
      credential: LaunchCredential,
      language: unknown,
    ) {
      const chosen = yield* Schema.decodeUnknownEffect(CoachLanguage)(language).pipe(
        Effect.mapError(() => new UnsupportedLanguage()),
      )
      const principal = yield* session.authenticateForTermsAcceptance(
        credential,
        WRITE_WINDOW_MILLIS,
      )
      const now = yield* Clock.currentTimeMillis
      yield* members
        .setLanguage({ memberId: principal.memberId, language: chosen, now: new Date(now) })
        .pipe(Effect.mapError(() => new CoachSession.LoadFailed({ operation: "setLanguage" })))

      return yield* openApp(credential)
    })

    /**
     * The version the client read is compared against the server's constant and
     * then the server's constant is what gets written. A caller-supplied string
     * never lands in a legal column — the comparison is a freshness check on the
     * screen, not the source of the record.
     */
    const acceptTerms = Effect.fn("CoachSurface.acceptTerms")(function* (
      credential: LaunchCredential,
      version: unknown,
    ) {
      if (version !== TERMS_VERSION) {
        return yield* new StaleTermsVersion({ current: TERMS_VERSION })
      }

      const principal = yield* session.authenticateForTermsAcceptance(
        credential,
        WRITE_WINDOW_MILLIS,
      )
      const now = yield* Clock.currentTimeMillis
      yield* members
        .acceptTerms({ memberId: principal.memberId, version: TERMS_VERSION, now: new Date(now) })
        .pipe(Effect.mapError(() => new CoachSession.LoadFailed({ operation: "acceptTerms" })))

      // Re-read through the *strong* gate. It is the honest statement of what
      // just happened — this coach is now onboarded — and it fails loudly if the
      // write did not take, rather than handing back a home screen assembled
      // from what the acceptance call happened to know.
      const onboarded = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      return yield* home(onboarded)
    })

    return Service.of({ openApp, acceptTerms, chooseLanguage })
  }),
)

export * as CoachSurface from "./coach-surface.ts"
