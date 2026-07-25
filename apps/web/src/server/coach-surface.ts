import { MemberRepo } from "@praximo/db"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { TERMS_VERSION } from "@/features/legal/versions.ts"
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
  | { readonly kind: "terms-required"; readonly termsVersion: string }
  | {
      readonly kind: "home"
      readonly botUsername: string
      readonly telegramBotId: string
      readonly language: string
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
}

export class Service extends Context.Service<Service, Interface>()("@praximo/web/CoachSurface") {}

/**
 * The screen the coach agreed on is not the text the server would record. The
 * client reloads rather than the server quietly accepting a different document
 * than the one that was read.
 */
export class StaleTermsVersion extends Schema.TaggedErrorClass<StaleTermsVersion>()(
  "CoachSurface.StaleTermsVersion",
  { current: Schema.String },
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* CoachSession.Service
    const members = yield* MemberRepo.Service

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
        return { kind: "terms-required", termsVersion: TERMS_VERSION } satisfies CoachEntry
      }
      return {
        kind: "home",
        botUsername: principal.botUsername,
        telegramBotId: principal.telegramBotId,
        language: principal.language,
      } satisfies CoachEntry
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
      return {
        kind: "home",
        botUsername: onboarded.botUsername,
        telegramBotId: onboarded.telegramBotId,
        language: onboarded.language,
      } satisfies CoachEntry
    })

    return Service.of({ openApp, acceptTerms })
  }),
)

export * as CoachSurface from "./coach-surface.ts"
