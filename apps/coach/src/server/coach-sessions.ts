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
 * The coach's day and their calendar (#61): Today, the flat list in both of its
 * directions (#232), and one session.
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

/**
 * A session the calendar has finished with, as the Past view lists one (#232).
 *
 * `state` and `cancelReason` ride along here and **not** on `SessionSummary`,
 * which Today and the Upcoming view share: a session still ahead has nothing to
 * say about its state, and a field with no reader is a field that drifts. Here
 * they are the whole point of the row — a past session that does not say what
 * became of it is a date with no meaning attached.
 */
export interface PastSessionSummary extends SessionSummary {
  readonly state: SessionState
  /** Absent on every state but `cancelled`. */
  readonly cancelReason?: SessionCancelReason
}

/**
 * The sessions list, both of its views, in one answer (#232).
 *
 * One read rather than two because the screen is one screen: the segment
 * switches which half is on show and writes nothing, so a coach who taps Past
 * should not be waiting on a network round trip to find out whether there is
 * anything behind it. The two halves are complements — `sessionStillAhead`
 * decides, and the repository's two statements are that rule in SQL — so a
 * session appears under exactly one of them.
 */
export interface SessionsList {
  /** Everything ahead, earliest first. */
  readonly upcoming: ReadonlyArray<SessionSummary>
  /** Everything behind, newest first. */
  readonly past: ReadonlyArray<PastSessionSummary>
  /**
   * Whether the past read hit its bound, so the screen can say it is looking
   * through a window rather than at everything. Decided here, where the limit
   * is, rather than by a screen counting rows against a number it was told.
   */
  readonly pastBounded: boolean
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

/**
 * How far back the Past view will draw.
 *
 * Smaller than the bound above, and for the opposite reason: a practice has a
 * ceiling on what it can book ahead and none at all on what it has already done
 * — three a day is a thousand a year — so this one really is a window, and the
 * screen says so when it is full. There is no «show more»: the targeted
 * question, *what have I done with this person*, is answered on their own route.
 */
export const PastSessionsLimit = 200

/** One day cannot hold more than the business day divided by the grid step. */
const DaySessionsLimit = 100

export interface Interface {
  readonly today: (
    credential: LaunchCredential,
  ) => Effect.Effect<TodayView, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly list: (
    credential: LaunchCredential,
  ) => Effect.Effect<SessionsList, CoachSession.Unauthenticated | CoachSession.LoadFailed>
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

/** The same row, plus what became of it — the Past view's own summary (#232). */
const summarisePast = (row: SessionRepo.ScheduledSessionRow): PastSessionSummary => ({
  ...summarise(row),
  state: row.state,
  ...(row.cancelReason === undefined ? {} : { cancelReason: row.cancelReason }),
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
     * The whole list, both ways round, cut at the *start of the coach's today*
     * rather than at this minute.
     *
     * A session that began twenty minutes ago is still today's, and Today shows
     * it: a list that dropped it the moment it started would disagree with the
     * dashboard it was reached from. The same instant is what Past reads back
     * from, which is what makes the two views complements rather than two
     * filters that happen to agree — a session is on exactly one of them, and
     * a session left `scheduled` after its hour is on the second.
     *
     * Both reads go together: neither needs the other's answer, and the coach
     * who taps Past has already paid for it.
     */
    const list = Effect.fn("CoachSessions.list")(function* (credential: LaunchCredential) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      const timezone = zoneOf(principal)
      const floor = instantOf(localParts(now, timezone).date, 0, timezone) ?? now

      const [ahead, behind] = yield* Effect.all(
        [
          sessions
            .scheduled({
              workspaceId: principal.workspaceId,
              from: floor,
              limit: UpcomingSessionsLimit,
            })
            .pipe(Effect.mapError(failed("sessions.scheduled"))),
          sessions
            .past({
              workspaceId: principal.workspaceId,
              before: floor,
              limit: PastSessionsLimit,
            })
            .pipe(Effect.mapError(failed("sessions.past"))),
        ],
        { concurrency: "unbounded" },
      )

      return {
        upcoming: ahead.map(summarise),
        past: behind.map(summarisePast),
        pastBounded: behind.length === PastSessionsLimit,
        timezone,
      } satisfies SessionsList
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

    return Service.of({ today, list, detail, reschedule, cancel })
  }),
)

export * as CoachSessions from "./coach-sessions.ts"
