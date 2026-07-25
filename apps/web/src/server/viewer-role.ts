import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import { AdminRepo, WorkspaceRepo } from "@praximo/db"
import type { WorkspaceId } from "@praximo/domain"
import { Context, Effect, Layer, Result, Schema } from "effect"

/**
 * The coach half of a viewer's role, as the manager Mini App's entry reads it
 * (#106; lifecycle contract in #112). It is deliberately *not* an enum shared
 * with the admin list's stages: this answers "what does this person open right
 * now", not "where is this coach's onboarding".
 *
 * Every state carries the one link its screen offers, minted server-side
 * because only the server knows the manager bot's username and the invite's
 * code. `accepted` resumes through the original deep link — the same code, so
 * the claim is resumed rather than re-taken; the bot-bearing states point at
 * the coach's own bot.
 */
export type ViewerCoach =
  | { readonly state: "accepted"; readonly workspaceId: WorkspaceId; readonly link: string }
  | {
      readonly state: "bot-connected"
      readonly workspaceId: WorkspaceId
      readonly botUsername: string
      readonly link: string
    }
  | {
      readonly state: "active"
      readonly workspaceId: WorkspaceId
      readonly botUsername: string
      readonly link: string
    }
  /**
   * The coach's own bot is beyond repair and only they can reconnect it (#55).
   * Its `link` points at the **manager** bot, not at `t.me/{botUsername}` — the
   * whole point of the state is that their bot cannot answer — and carries the
   * reserved recovery payload, because an existing chat shows no **Start**
   * button and a bare link would reach nothing.
   */
  | {
      readonly state: "needs-relink"
      readonly workspaceId: WorkspaceId
      readonly botUsername: string
      readonly link: string
    }

/**
 * What the manager Mini App's entry resolves before it renders anything.
 *
 * The two roles are independent rather than mutually exclusive: an operator
 * dogfooding as a coach is both, and the entry still sends them to `/admin` —
 * the admin surface carries the contextual coach action itself (#107). `coach`
 * is `null` for anyone with no claim and no workspace, which is what the
 * invite-only landing renders from.
 */
export interface Role {
  readonly isAdmin: boolean
  readonly coach: ViewerCoach | null
}

export interface Interface {
  readonly resolveRole: (initData: string) => Effect.Effect<Role, Unauthenticated | LoadFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/web/ViewerRole") {}

/**
 * The launch credential is missing, malformed, or not signed by the manager
 * bot. Deliberately distinct from "authenticated but unknown": one is a broken
 * entry, the other a real person who has not been invited yet.
 */
export class Unauthenticated extends Schema.TaggedErrorClass<Unauthenticated>()(
  "ViewerRole.Unauthenticated",
  {},
) {}

export class LoadFailed extends Schema.TaggedErrorClass<LoadFailed>()("ViewerRole.LoadFailed", {
  operation: Schema.String,
}) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const initData = yield* ManagerInitData.Service
    const admins = yield* AdminRepo.Service
    const workspaces = yield* WorkspaceRepo.Service
    const tokens = yield* CoachOnboardingToken.Service

    const presentCoach = Effect.fn("ViewerRole.presentCoach")(function* (
      coach: WorkspaceRepo.CoachContext,
    ) {
      if (coach.state === "accepted") {
        return {
          state: "accepted",
          workspaceId: coach.workspaceId,
          link: yield* tokens.linkFor(coach.code),
        } satisfies ViewerCoach
      }
      if (coach.state === "needs-relink") {
        return {
          state: "needs-relink",
          workspaceId: coach.workspaceId,
          botUsername: coach.botUsername,
          link: yield* tokens.relinkLink(),
        } satisfies ViewerCoach
      }
      return {
        state: coach.state,
        workspaceId: coach.workspaceId,
        botUsername: coach.botUsername,
        link: `https://t.me/${coach.botUsername}`,
      } satisfies ViewerCoach
    })

    /**
     * Both halves are resolved for every viewer, admin or not: the admin gate
     * is a lookup, not a wall, so a coach reaching the same entry gets their own
     * screen instead of a rejection. Absence of an admin record is an ordinary
     * answer here — only a failing lookup is an error.
     */
    const resolveRole = Effect.fn("ViewerRole.resolveRole")(function* (rawInitData: string) {
      const telegramId = yield* initData
        .verify(rawInitData)
        .pipe(Effect.mapError(() => new Unauthenticated()))

      const admin = yield* admins.findByTelegramId(telegramId).pipe(Effect.result)
      if (Result.isFailure(admin) && admin.failure._tag !== "Domain.AdminNotFound") {
        return yield* new LoadFailed({ operation: "findAdmin" })
      }

      const coach = yield* workspaces
        .findCoachByTelegramId(telegramId)
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "findCoach" })))

      return {
        isAdmin: Result.isSuccess(admin),
        coach: coach === undefined ? null : yield* presentCoach(coach),
      } satisfies Role
    })

    return Service.of({ resolveRole })
  }),
)

export * as ViewerRole from "./viewer-role.ts"
