import type { CoachLanguage, SessionCancelReason, SessionState } from "@praximo/domain"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"

import { HostBackButton } from "@/mini-app.tsx"
import { HostMainButton } from "@/mini-app.tsx"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Card } from "@praximo/ui/components/card"
import { SessionKindLine } from "@/features/coach/components/session-kind-line.tsx"
import { groupByDay, sessionClock } from "@/features/coach/session-days.ts"
import { stateSentence } from "@/features/coach/session-standing.ts"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import { Heading, Section, SegmentedChoice, Text } from "@praximo/ui"
import type { CoachSessions } from "@/server/coach-sessions.ts"

/**
 * The sessions list (#61): everything, flat, grouped by the coach's own day —
 * and since #232 in both directions.
 *
 * The two views are **complements**, cut at the start of the coach's today by
 * the same instant on the server, so every session is on exactly one of them and
 * nothing falls between. That is what lets the segment be a segment: it changes
 * which half is on show and writes nothing — no URL, no record, nothing to
 * restore.
 *
 * A healthy session says nothing about its state; only a broken one speaks. On
 * Upcoming the one thing that can be broken is a client who never accepted; on
 * Past that warning is meaningless — the day has gone — and what speaks instead
 * is what became of the session.
 */

/**
 * A row of either view. **`state` present is what makes it a past one** — the
 * server puts it on `PastSessionSummary` and on nothing else, so the row does
 * not need to be told which list it came from.
 */
type ListedSession = CoachSessions.SessionSummary & {
  readonly state?: SessionState
  readonly cancelReason?: SessionCancelReason
}

function SessionRow({
  copy,
  clock,
  session,
}: {
  readonly copy: CoachCopy
  readonly clock: Intl.DateTimeFormat
  readonly session: ListedSession
}) {
  const standing =
    session.state === undefined
      ? undefined
      : stateSentence(copy.sessions, session.state, session.cancelReason)

  return (
    <li>
      <Link
        to="/sessions/$sessionId"
        params={{ sessionId: session.id }}
        className="transition-colors duration-100 active:bg-muted flex min-h-16 items-center gap-4 px-5 py-3 text-left"
      >
        <span className="text-base leading-relaxed font-semibold tabular-nums">
          {clock.format(new Date(session.scheduledAt))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base leading-relaxed font-medium">
            {session.clientName}
          </span>
          <SessionKindLine
            copy={copy.clients}
            kind={session.kind}
            durationMinutes={session.durationMinutes}
            className="mt-0.5"
          />
          {session.state === undefined && !session.clientAccepted ? (
            <span className="mt-1 block truncate text-xs leading-normal text-warning">
              {copy.sessions.rowUnaccepted}
            </span>
          ) : null}
          {/*
            Muted, never the warning colour: an automatic cancellation is what
            happened to a session, not something the coach has to do anything
            about — the same rule the session screen states it under (#62).
          */}
          {standing === undefined ? null : (
            <span className="text-muted-foreground mt-1 block truncate text-xs leading-normal">
              {standing}
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}

export function SessionsScreen({
  copy,
  language,
  list,
  now,
  past,
  onView,
  onCreate,
}: {
  readonly copy: CoachCopy
  readonly language: CoachLanguage
  readonly list: CoachSessions.SessionsList
  /** Passed in rather than read here, so the grouping is testable at an instant. */
  readonly now: Date
  /**
   * Which half is on show. Held by the route rather than here, for the same
   * reason `now` is: the screen stays a pure function of what it is given, so
   * both views can be rendered and read. The route resets it on every entry —
   * a coach opening this screen is nearly always asking what happens next.
   */
  readonly past: boolean
  readonly onView: (past: boolean) => void
  /** Opens the client picker — a session is always somebody's. */
  readonly onCreate: () => void
}) {
  const clock = useMemo(() => sessionClock(language, list.timezone), [language, list.timezone])
  const shown: ReadonlyArray<ListedSession> = past ? list.past : list.upcoming
  const days = useMemo(
    () =>
      groupByDay(shown, {
        timezone: list.timezone,
        language,
        now,
        words: { today: copy.sessions.today, tomorrow: copy.sessions.tomorrow },
      }),
    [copy, language, list.timezone, now, shown],
  )

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-28">
      <HostBackButton label={copy.common.back} />

      <Heading as="h1" role="page-title" className="mt-2">
        {copy.sessions.listTitle}
      </Heading>

      {/*
        **Always here**, including on the practice whose history is still empty.
        `mini-app.md`'s absent-rather-than-present-and-empty rule is about
        dashboard blocks that promise content the coach then hunts for; this is
        navigation the coach chose to open, and a control that materialises weeks
        later — once #42 starts writing terminal states — is worse than a list
        with a sentence in it.
      */}
      <div role="group" aria-label={copy.sessions.viewLabel} className="mt-4 flex gap-0.5">
        <SegmentedChoice selected={!past} onClick={() => onView(false)}>
          {copy.sessions.viewUpcoming}
        </SegmentedChoice>
        <SegmentedChoice selected={past} onClick={() => onView(true)}>
          {copy.sessions.viewPast}
        </SegmentedChoice>
      </div>

      {days.length === 0 ? (
        <Text className="text-muted-foreground mt-6">
          {past ? copy.sessions.pastEmpty : copy.sessions.empty}
        </Text>
      ) : (
        days.map((day) => (
          <Section key={day.date} className="mt-8">
            <Heading
              as="h2"
              role="card-title"
              className="text-muted-foreground px-1 font-semibold tracking-wide uppercase"
            >
              {day.heading}
            </Heading>
            <Card className="mt-3 gap-0 overflow-hidden py-0">
              <ul className="divide-border divide-y">
                {day.sessions.map((session) => (
                  <SessionRow key={session.id} copy={copy} clock={clock} session={session} />
                ))}
              </ul>
            </Card>
          </Section>
        ))
      )}

      {/*
        The bound, said out loud rather than hidden (#232). A practice has no
        ceiling on what it has already done, so Past is a window — and a window
        the screen does not admit to is a list that has quietly stopped being
        true. No «show more» under it: the targeted question, *what have I done
        with this person*, is answered on their own route.
      */}
      {past && list.pastBounded ? (
        <Text role="caption" className="text-muted-foreground mt-6 px-1">
          {copy.sessions.pastBounded(list.past.length)}
        </Text>
      ) : null}

      {/*
        The screen's own action, in the host's fixed place (#198). Today already
        offers it, but a coach who has drilled into the full list is exactly the
        one about to add to it, and until now this screen was the only read-only
        one in the flow.

        It opens the picker rather than the scheduling screen, because a session
        is always somebody's. Today swaps this label to `New client` on an empty
        practice, to avoid a picker with nothing in it; here the picker is the
        one that knows — with no clients it says so and offers to create one, so
        the button leads somewhere either way rather than needing a second read
        of the roster on this route.

        It stays on both views: a coach reading what happened last week is a
        coach about to book the next one.
      */}
      <HostMainButton
        text={copy.today.newSession}
        onClick={onCreate}
        fallback={
          <ActionBar>
            <Button className="w-full" onClick={onCreate}>
              {copy.today.newSession}
            </Button>
          </ActionBar>
        }
      />
    </main>
  )
}
