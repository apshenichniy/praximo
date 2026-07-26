import type { CoachLanguage } from "@praximo/domain"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { Card } from "@/components/ui/card.tsx"
import { SessionKindLine } from "@/features/coach/components/session-kind-line.tsx"
import { groupByDay, sessionClock } from "@/features/coach/session-days.ts"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { Section } from "@/features/mini-app/components/section.tsx"
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
}: {
  readonly copy: CoachCopy
  readonly language: CoachLanguage
  readonly upcoming: CoachSessions.UpcomingSessions
  /** Passed in rather than read here, so the grouping is testable at an instant. */
  readonly now: Date
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
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <TelegramBackButton label={copy.common.back} />

      <h1 className="mt-2 text-title font-semibold tracking-tight">{copy.sessions.listTitle}</h1>

      {days.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-body leading-5">{copy.sessions.empty}</p>
      ) : (
        days.map((day) => (
          <Section key={day.date} className="mt-8">
            <h2 className="text-muted-foreground px-1 text-caption font-semibold tracking-wide uppercase">
              {day.heading}
            </h2>
            <Card className="mt-3 gap-0 overflow-hidden py-0">
              <ul className="divide-border divide-y">
                {day.sessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      to="/sessions/$sessionId"
                      params={{ sessionId: session.id }}
                      className="flex min-h-16 items-center gap-4 px-5 py-3 text-left"
                    >
                      <span className="text-body font-semibold tabular-nums">
                        {clock.format(new Date(session.scheduledAt))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium">
                          {session.clientName}
                        </span>
                        <SessionKindLine
                          copy={copy.clients}
                          kind={session.kind}
                          durationMinutes={session.durationMinutes}
                          className="mt-0.5"
                        />
                        {session.clientAccepted ? null : (
                          <span className="mt-1 block truncate text-caption text-amber-200/80">
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
    </main>
  )
}
