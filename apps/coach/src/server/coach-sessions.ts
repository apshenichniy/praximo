import { ClientRepo, SessionRepo, WorkspaceRepo } from "@praximo/db"
import {
  inviteNeedsAttention,
  MinutesInDay,
  readMemberSettings,
  readWorkingHours,
  type SessionCancelReason,
  type SessionState,
  type WorkingHours,
} from "@praximo/domain"
import { Clock, Context, Effect, Layer } from "effect"
import { CoachSession, READ_WINDOW_MILLIS, WRITE_WINDOW_MILLIS } from "./coach-session.ts"
import { localParts } from "@/lib/coach-calendar.ts"
import { instantOf, zoneOf } from "./coach-day.ts"
import { sessionDraft } from "./session-draft.ts"
import type { LaunchCredential } from "@/launch-credential.ts"

/**
 * The coach's day and their calendar (#61): Today, the flat upcoming list, and
 * one session.
 *
 * A service of its own rather than more of `CoachClients`, per the seam rule
 * (#38). `CoachClients` answers "who is in this practice and what do I do to
 * them"; this one answers "what happens, and when". They meet in exactly two
 * places — Today needs the invitations that are about to lapse, and every
 * session names its client — and both of those are reads, not writes.
 */

/** A session as any screen that lists one shows it. */
export interface SessionSummary {
  readonly id: string
  readonly clientId: string
  readonly clientName: string
  /** ISO string, because this crosses a server-function boundary. */
  readonly scheduledAt: string
  readonly durationMinutes: number
  readonly kind: string
  /**
   * False while the client has never accepted. The session is real and the day
   * is real; what is missing is the Channel a join link travels through, so this
   * is the one thing an otherwise healthy session has to say about itself.
   */
  readonly clientAccepted: boolean
}

/**
 * An invitation Today calls out: already lapsed, or inside its last two days.
 * Nothing else earns a place there — every pending invitation would make this a
 * duplicate of the clients list wearing the word «attention».
 */
export interface AttentionInvite {
  readonly clientId: string
  readonly clientName: string
  readonly expiresAt: string
  readonly expired: boolean
}

export interface TodayView {
  /**
   * The coach, as they are named everywhere: the workspace label their own bot
   * introduces them by. There is no separate coach name column, and inventing a
   * second one would let the greeting and the client's invitation disagree.
   */
  readonly coachName: string
  readonly timezone: string
  /** Everything on today's calendar, unclipped — including what already began. */
  readonly sessions: ReadonlyArray<SessionSummary>
  readonly attention: ReadonlyArray<AttentionInvite>
  /**
   * No clients at all. It drives both the checklist and the host's bottom
   * button, which reads `New client` here because `New session` would open a
   * picker with nothing in it.
   */
  readonly emptyPractice: boolean
  /** Whether the Main Mini App hint still has a job — the same rule as #56's. */
  readonly mainMiniAppHintVisible: boolean
  /**
   * The week the coach works (#210), so the dashboard can state it rather than
   * merely lead to it. A coach wondering why Saturday stopped being offered is
   * looking at this screen when the thought arrives.
   */
  readonly workingHours: WorkingHours
}

export interface UpcomingSessions {
  readonly sessions: ReadonlyArray<SessionSummary>
  readonly timezone: string
}

/**
 * One session's facts, and — since #62 — what became of it.
 *
 * `state` and `cancelReason` arrive with the screen that acts on them. Until
 * then they were deliberately absent: a stub screen has no way to say
 * "cancelled" that is not a lifecycle claim, and a column with no reader is a
 * field that drifts.
 */
export interface SessionDetail extends SessionSummary {
  readonly timezone: string
  readonly state: SessionState
  /** Absent on every state but `cancelled`. */
  readonly cancelReason?: SessionCancelReason
}

/** Where a session is being moved to. Its client and kind do not change (#62). */
export interface RescheduleSessionInput {
  /** `YYYY-MM-DD`, in the coach's own calendar. */
  readonly date: string
  readonly startMinutes: number
  readonly durationMinutes: number
}

/**
 * The four ways a move is refused, and the screen acts on each one differently.
 *
 * `invalid` and `past` are decided from the draft alone and never reach the
 * database; `overlap` asks for another time; `gone` means the session moved on
 * underneath the coach, so the screen re-reads rather than only complaining.
 */
export type RescheduleOutcome =
  | { readonly rescheduled: true }
  | {
      readonly rescheduled: false
      readonly reason: "invalid" | "past" | "overlap" | "gone"
    }

/**
 * How many sessions ahead the flat list will draw.
 *
 * Far past what a solo coach books — a full year at three a day is under a
 * thousand — so it is a bound on a runaway query rather than a page size, and
 * there is no "show more" it is hiding.
 */
export const UpcomingSessionsLimit = 500

/** One day cannot hold more than the business day divided by the grid step. */
const DaySessionsLimit = 100

export interface Interface {
  readonly today: (
    credential: LaunchCredential,
  ) => Effect.Effect<TodayView, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly upcoming: (
    credential: LaunchCredential,
  ) => Effect.Effect<UpcomingSessions, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly detail: (
    credential: LaunchCredential,
    sessionId: string,
  ) => Effect.Effect<
    SessionDetail | undefined,
    CoachSession.Unauthenticated | CoachSession.LoadFailed
  >
  readonly reschedule: (
    credential: LaunchCredential,
    input: RescheduleSessionInput & { readonly sessionId: string },
  ) => Effect.Effect<RescheduleOutcome, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly cancel: (
    credential: LaunchCredential,
    sessionId: string,
  ) => Effect.Effect<
    { readonly cancelled: boolean },
    CoachSession.Unauthenticated | CoachSession.LoadFailed
  >
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/coach/CoachSessions",
) {}

const iso = (value: Date): string => value.toISOString()

const failed = (operation: string) => () => new CoachSession.LoadFailed({ operation })

const summarise = (row: SessionRepo.ScheduledSessionRow): SessionSummary => ({
  id: row.id,
  clientId: row.clientId,
  clientName: row.clientName,
  scheduledAt: iso(row.scheduledAt),
  durationMinutes: row.durationMinutes,
  kind: row.kind,
  clientAccepted: row.clientAccepted,
})

/**
 * What needs attention, out of the whole practice and the day already on screen.
 *
 * Two rules, and both are about what it leaves out. Only invitations that have
 * lapsed or are inside their last two days — every pending one would make this
 * the biggest section on a fresh practice, a duplicate of the clients list
 * wearing the word «attention». And **nobody whose card is already on today's
 * screen**: that card says it for today, the sessions list says it for the rest,
 * and a third place would undo the point of the first rule (#61).
 *
 * Pure and exported, because it is the whole of the section's meaning and the
 * layer around it is three repository reads.
 */
export const attentionFor = (
  roster: ReadonlyArray<ClientRepo.ClientListRow>,
  today: ReadonlyArray<SessionRepo.ScheduledSessionRow>,
  now: Date,
): ReadonlyArray<AttentionInvite> => {
  const spokenFor = new Set(today.map((row) => row.clientId))
  return orderAttention(
    roster
      .filter(
        (row) =>
          !spokenFor.has(row.id) && inviteNeedsAttention(row.state, row.inviteExpiresAt, now),
      )
      .map((row) => ({
        clientId: row.id,
        clientName: row.name,
        expiresAt: iso(row.inviteExpiresAt),
        expired: row.state === "expired",
      })),
  )
}

/**
 * The lapsed first, then whatever expires soonest.
 *
 * Sorted here rather than on the screen because it is the same order in every
 * language, and a section this short is read top-down.
 */
export const orderAttention = (
  items: ReadonlyArray<AttentionInvite>,
): ReadonlyArray<AttentionInvite> =>
  // In-place is safe and intended: the copy is made right here, and the ES2022
  // target has no `toSorted` to make it again.
  // oxlint-disable-next-line unicorn/no-array-sort
  [...items].sort((left, right) => {
    if (left.expired !== right.expired) return left.expired ? -1 : 1
    return Date.parse(left.expiresAt) - Date.parse(right.expiresAt)
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* CoachSession.Service
    const sessions = yield* SessionRepo.Service
    const clients = yield* ClientRepo.Service
    const workspaces = yield* WorkspaceRepo.Service

    /**
     * Today, assembled from one day of the calendar and the whole client list.
     *
     * The day is bracketed in the *coach's* zone, so a coach in Kyiv opening the
     * app at 23:30 is still looking at their own Monday rather than at Tuesday
     * in UTC. The three reads run together: none of them needs another's answer.
     */
    const today = Effect.fn("CoachSessions.today")(function* (credential: LaunchCredential) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      const timezone = zoneOf(principal)
      const here = localParts(now, timezone)
      const from = instantOf(here.date, 0, timezone)
      const to = instantOf(here.date, MinutesInDay, timezone)

      const [day, roster, workspace] = yield* Effect.all(
        [
          from === undefined || to === undefined
            ? Effect.succeed([] as ReadonlyArray<SessionRepo.ScheduledSessionRow>)
            : sessions
                .scheduled({
                  workspaceId: principal.workspaceId,
                  from,
                  to,
                  limit: DaySessionsLimit,
                })
                .pipe(Effect.mapError(failed("sessions.scheduled"))),
          clients.list(principal.workspaceId, now).pipe(Effect.mapError(failed("clients.list"))),
          workspaces
            .findById(principal.workspaceId)
            .pipe(Effect.mapError(failed("workspace.findById"))),
        ],
        { concurrency: "unbounded" },
      )

      const settings = readMemberSettings(principal.settings)
      return {
        coachName: workspace.name,
        timezone,
        sessions: day.map(summarise),
        attention: attentionFor(roster, day, now),
        emptyPractice: roster.length === 0,
        mainMiniAppHintVisible:
          settings.mainMiniAppHintDismissed !== true && !principal.hasMainMiniApp,
        workingHours: readWorkingHours(settings.workingHours),
      } satisfies TodayView
    })

    /**
     * Everything ahead, from the *start of the coach's today* rather than from
     * this minute.
     *
     * A session that began twenty minutes ago is still today's, and Today shows
     * it: a list that dropped it the moment it started would disagree with the
     * dashboard it was reached from. Nothing here is past in the sense #62
     * means — no session can be `completed` before #42.
     */
    const upcoming = Effect.fn("CoachSessions.upcoming")(function* (credential: LaunchCredential) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      const timezone = zoneOf(principal)
      const from = instantOf(localParts(now, timezone).date, 0, timezone) ?? now

      const rows = yield* sessions
        .scheduled({ workspaceId: principal.workspaceId, from, limit: UpcomingSessionsLimit })
        .pipe(Effect.mapError(failed("sessions.scheduled")))

      return { sessions: rows.map(summarise), timezone } satisfies UpcomingSessions
    })

    const detail = Effect.fn("CoachSessions.detail")(function* (
      credential: LaunchCredential,
      sessionId: string,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      const row = yield* sessions
        .find(principal.workspaceId, sessionId)
        .pipe(Effect.mapError(failed("sessions.find")))
      if (row === undefined) return undefined
      return {
        ...summarise(row),
        timezone: zoneOf(principal),
        state: row.state,
        ...(row.cancelReason === undefined ? {} : { cancelReason: row.cancelReason }),
      } satisfies SessionDetail
    })

    /**
     * The move: a draft decided here, an overlap decided by the statement.
     *
     * The split is the same one `CoachClients.schedule` makes, through the same
     * `sessionDraft` — so a start off the grid is `invalid` on both screens and
     * a time that has gone by is `past` on both. What is left for the database
     * is the pair only it can answer: is anything else in the way, and is this
     * session still the coach's to move.
     */
    const reschedule = Effect.fn("CoachSessions.reschedule")(function* (
      credential: LaunchCredential,
      input: RescheduleSessionInput & { readonly sessionId: string },
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const now = yield* Clock.currentTimeMillis
      const draft = sessionDraft({
        date: input.date,
        startMinutes: input.startMinutes,
        durationMinutes: input.durationMinutes,
        timezone: zoneOf(principal),
        nowMillis: now,
      })
      if (!draft.ok) return { rescheduled: false, reason: draft.reason } as const

      const outcome = yield* sessions
        .reschedule({
          workspaceId: principal.workspaceId,
          sessionId: input.sessionId,
          scheduledAt: draft.at,
          durationMinutes: input.durationMinutes,
          now: new Date(now),
        })
        .pipe(Effect.mapError(failed("sessions.reschedule")))

      return outcome.rescheduled
        ? ({ rescheduled: true } as const)
        : ({ rescheduled: false, reason: outcome.reason } as const)
    })

    /**
     * The coach's own cancellation, and nothing else about it: the reason is the
     * repository's, and there is no parameter here for a second one (ADR 0005).
     */
    const cancel = Effect.fn("CoachSessions.cancel")(function* (
      credential: LaunchCredential,
      sessionId: string,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      return yield* sessions
        .cancel(principal.workspaceId, sessionId, now)
        .pipe(Effect.mapError(failed("sessions.cancel")))
    })

    return Service.of({ today, upcoming, detail, reschedule, cancel })
  }),
)

export * as CoachSessions from "./coach-sessions.ts"
