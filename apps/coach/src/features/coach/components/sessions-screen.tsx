import type { CoachLanguage } from "@praximo/domain"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"

import { HostBackButton } from "@/presentation-host"
import { HostMainButton } from "@/presentation-host"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Card } from "@praximo/ui/components/card"
import { SessionKindLine } from "@/features/coach/components/session-kind-line.tsx"
import { groupByDay, sessionClock } from "@/features/coach/session-days.ts"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import { Heading, Section, Text } from "@praximo/ui"
import type { CoachSessions } from "@/server/coach-sessions.ts"

/**
 * The sessions list (#61): everything ahead, flat, grouped by the coach's own
 * day.
 *
 * **No past section.** No session can be `completed` before #42, so a history
 * heading here would be a heading over nothing — the same rule that keeps the
 * artifacts feed off Today. #62 brings history.
 *
 * A healthy session says nothing about its state; only a broken one speaks, and
 * the one thing that can be broken here is a client who never accepted.
 */
export function SessionsScreen({
  copy,
  language,
  upcoming,
  now,
  onCreate,
}: {
  readonly copy: CoachCopy
  readonly language: CoachLanguage
  readonly upcoming: CoachSessions.UpcomingSessions
  /** Passed in rather than read here, so the grouping is testable at an instant. */
  readonly now: Date
  /** Opens the client picker — a session is always somebody's. */
  readonly onCreate: () => void
}) {
  const clock = useMemo(
    () => sessionClock(language, upcoming.timezone),
    [language, upcoming.timezone],
  )
  const days = useMemo(
    () =>
      groupByDay(upcoming.sessions, {
        timezone: upcoming.timezone,
        language,
        now,
        words: { today: copy.sessions.today, tomorrow: copy.sessions.tomorrow },
      }),
    [copy, language, now, upcoming],
  )

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-28">
      <HostBackButton label={copy.common.back} />

      <Heading as="h1" role="page-title" className="mt-2">
        {copy.sessions.listTitle}
      </Heading>

      {days.length === 0 ? (
        <Text className="text-muted-foreground mt-6">{copy.sessions.empty}</Text>
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
                  <li key={session.id}>
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
                        {session.clientAccepted ? null : (
                          <span className="mt-1 block truncate text-xs leading-normal text-warning">
                            {copy.sessions.rowUnaccepted}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        ))
      )}

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
