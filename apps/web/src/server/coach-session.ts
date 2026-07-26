import { CoachInitData } from "@praximo/auth"
import { MemberRepo } from "@praximo/db"
import type { CoachLanguage, WorkspaceId } from "@praximo/domain"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import type { LaunchCredential } from "./launch-credential.ts"

/** Reads accept the window Telegram's own credential lifetime implies. */
export const READ_WINDOW_MILLIS = 24 * 60 * 60 * 1_000

/**
 * State changes accept fifteen minutes. The terms screen is by construction the
 * first screen of a fresh launch, so this costs an honest coach nothing while
 * removing most of the replay exposure on a legally operative first write
 * (ADR 0006).
 */
export const WRITE_WINDOW_MILLIS = 15 * 60 * 1_000

/** How often a launch is allowed to move `last_activity_at`. */
const ACTIVITY_THROTTLE_MILLIS = 15 * 60 * 1_000

/**
 * A verified coach who has *not* necessarily accepted the terms. It carries no
 * `workspaceId` on purpose — see {@link CoachPrincipal}.
 */
export interface PreOnboardingPrincipal {
  readonly memberId: string
  readonly termsAcceptedAt: Date | undefined
  readonly termsVersion: string | undefined
  /**
   * What the launch itself already established — the coach's own bot and their
   * language. Here rather than only on the onboarded principal because the
   * screen shown *before* acceptance is still that coach's screen, and none of
   * it is a tenant key. `workspaceId` is, which is why it lives below.
   */
  readonly botUsername: string
  readonly telegramBotId: string
  /**
   * Whether that bot still answers Telegram. It travels with the principal
   * because this app is the only surface a coach with a dead bot can still
   * reach: their launch is signed by Telegram over the bot id, no token
   * involved, and the menu button that carries them here is Telegram-side state
   * a `/revoke` does not touch (#55).
   */
  readonly botConnectionStatus: MemberRepo.CoachPrincipalRow["botConnectionStatus"]
  readonly language: CoachLanguage
  /**
   * Telegram's own answer to "has this coach finished the @BotFather steps",
   * which is what lets the home screen's hint dismiss itself rather than offer
   * a button somebody can tap without having done them (#56).
   */
  readonly hasMainMiniApp: boolean
  /** The coach's stored zone, absent until their first launch after #56. */
  readonly timezone?: string
  /** `member.settings`, raw — read through the domain's tolerant reader. */
  readonly settings: unknown
}

/**
 * A verified, onboarded coach.
 *
 * The two principals differ in type, and that difference *is* the enforcement.
 * `workspaceId` — the tenant key every downstream operation needs — exists only
 * here, and only `requireOnboardedCoach` can produce one. A future operation
 * that reaches for the weaker entry point cannot compile, which is the part a
 * naming convention could not give us: both functions are equally discoverable
 * and the weaker one has the friendlier name.
 */
export interface CoachPrincipal extends PreOnboardingPrincipal {
  readonly workspaceId: WorkspaceId
}

export interface Interface {
  readonly authenticateForTermsAcceptance: (
    credential: LaunchCredential,
    maxAgeMillis: number,
  ) => Effect.Effect<PreOnboardingPrincipal, Unauthenticated | LoadFailed>
  readonly requireOnboardedCoach: (
    credential: LaunchCredential,
    maxAgeMillis: number,
  ) => Effect.Effect<CoachPrincipal, Unauthenticated | LoadFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/web/CoachSession") {}

/**
 * Undifferentiated on purpose. An unknown bot, an unknown member, a bad
 * signature, a stale credential and a workspace mid-deletion all arrive here,
 * and the transport maps this to one response — otherwise the difference
 * between them is an oracle for enumerating coaches.
 */
export class Unauthenticated extends Schema.TaggedErrorClass<Unauthenticated>()(
  "CoachSession.Unauthenticated",
  {},
) {}

export class LoadFailed extends Schema.TaggedErrorClass<LoadFailed>()("CoachSession.LoadFailed", {
  operation: Schema.String,
}) {}

/**
 * The single definition of "has accepted the terms", used by both entry points
 * so the two gates cannot drift. Version equality is deliberately not part of
 * it: a bump records what was accepted, it does not force re-acceptance, and no
 * re-acceptance flow exists to send anyone through (ADR 0006).
 */
export const isOnboarded = (principal: PreOnboardingPrincipal): boolean =>
  principal.termsAcceptedAt !== undefined

/**
 * Coach authentication: verify the launch, resolve it to a member, and record
 * that the launch happened.
 *
 * This composition lives in `apps/web` rather than in a package because it joins
 * `@praximo/auth` to `@praximo/db`, and neither depends on the other — packages
 * carry no app wiring (ADR 0002). It mirrors `viewer-role.ts`, which does the
 * same for the manager side, and its body is the one a Better Auth plugin would
 * later carry unchanged.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const initData = yield* CoachInitData.Service
    const members = yield* MemberRepo.Service

    /**
     * Which bot to verify this launch against.
     *
     * Ed25519 signs `<botId>:WebAppData` together with the payload, so a
     * candidate has to exist before anything can be checked. Ordinarily the
     * launch names it — the coach bot's Mini App URL carries `?b=`. When it does
     * not (a bot provisioned before that URL grew the parameter, or a Main Mini
     * App URL a coach pasted themselves), the only way to name one is to read
     * the user id the launch *claims* and probe for it.
     *
     * Both are untrusted hints, and they are treated identically: neither
     * authorizes anything, and the principal below is resolved from the verified
     * pair regardless. The probe is single-valued by
     * `member_owner_telegram_user_id_idx` rather than by a tie-break, and it
     * costs one indexed read.
     */
    const candidateBotId = Effect.fn("CoachSession.candidateBotId")(function* (
      credential: LaunchCredential,
    ) {
      if (credential.botId.length > 0) return credential.botId
      const claimed = yield* initData
        .unverifiedTelegramUserId(credential.initData)
        .pipe(Effect.mapError(() => new Unauthenticated()))
      const hint = yield* members
        .findCoachPrincipalByIdentity(claimed)
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "findCoachPrincipal" })))
      if (hint === undefined) return yield* new Unauthenticated()
      return hint.telegramBotId
    })

    /**
     * Order matters, and this is the order:
     *
     * 1. name a candidate bot — from the launch itself, or from the hint above;
     * 2. verify the signature against that candidate;
     * 3. resolve the *verified* pair to a member — always by the verified bot
     *    and the verified user, never by whatever the launch claimed;
     * 4. refuse a workspace whose deletion is already prepared;
     * 5. refuse a credential minted before the member's revocation floor;
     * 6. record the launch.
     */
    const authenticate = Effect.fn("CoachSession.authenticate")(function* (
      credential: LaunchCredential,
      maxAgeMillis: number,
    ) {
      const candidate = yield* candidateBotId(credential)
      const verified = yield* initData
        .verify(credential.initData, candidate, maxAgeMillis)
        .pipe(Effect.mapError(() => new Unauthenticated()))

      const found = yield* members
        .findCoachPrincipalByBot(verified.telegramBotId, verified.telegramUserId)
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "findCoachPrincipal" })))

      if (found === undefined || found.deletionPending) return yield* new Unauthenticated()
      if (
        found.credentialsValidFrom !== undefined &&
        verified.authDateMillis < found.credentialsValidFrom.getTime()
      ) {
        return yield* new Unauthenticated()
      }

      // Bookkeeping is not an authentication decision: a failed write here must
      // not turn a valid launch into a refused one. `last_login_at` comes from
      // the verified `auth_date` rather than a second read of the raw string.
      yield* members
        .touchLogin({ memberId: found.memberId, authDateMillis: verified.authDateMillis })
        .pipe(Effect.ignore)
      const now = yield* Clock.currentTimeMillis
      yield* members
        .touchActivity({
          memberId: found.memberId,
          now: new Date(now),
          throttleMillis: ACTIVITY_THROTTLE_MILLIS,
        })
        .pipe(Effect.ignore)

      return {
        memberId: found.memberId,
        workspaceId: found.workspaceId,
        language: found.language,
        botUsername: found.botUsername,
        telegramBotId: found.telegramBotId,
        botConnectionStatus: found.botConnectionStatus,
        hasMainMiniApp: found.hasMainMiniApp,
        ...(found.timezone === undefined ? {} : { timezone: found.timezone }),
        settings: found.settings,
        termsAcceptedAt: found.termsAcceptedAt,
        termsVersion: found.termsVersion,
      } satisfies CoachPrincipal
    })

    const authenticateForTermsAcceptance = Effect.fn("CoachSession.authenticateForTermsAcceptance")(
      function* (credential: LaunchCredential, maxAgeMillis: number) {
        const principal = yield* authenticate(credential, maxAgeMillis)
        return {
          memberId: principal.memberId,
          termsAcceptedAt: principal.termsAcceptedAt,
          termsVersion: principal.termsVersion,
          botUsername: principal.botUsername,
          telegramBotId: principal.telegramBotId,
          botConnectionStatus: principal.botConnectionStatus,
          hasMainMiniApp: principal.hasMainMiniApp,
          ...(principal.timezone === undefined ? {} : { timezone: principal.timezone }),
          settings: principal.settings,
          language: principal.language,
        } satisfies PreOnboardingPrincipal
      },
    )

    const requireOnboardedCoach = Effect.fn("CoachSession.requireOnboardedCoach")(function* (
      credential: LaunchCredential,
      maxAgeMillis: number,
    ) {
      const principal = yield* authenticate(credential, maxAgeMillis)
      return isOnboarded(principal) ? principal : yield* new Unauthenticated()
    })

    return Service.of({ authenticateForTermsAcceptance, requireOnboardedCoach })
  }),
)

export * as CoachSession from "./coach-session.ts"
