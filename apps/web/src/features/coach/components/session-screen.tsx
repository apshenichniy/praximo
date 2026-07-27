import type { CoachLanguage } from "@praximo/domain"
import { sessionMoment } from "@praximo/i18n"
import { Link } from "@tanstack/react-router"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { SessionKindLine } from "@/features/coach/components/session-kind-line.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { DetailCard, DetailRow } from "@/features/mini-app/components/detail-card.tsx"
import type { CoachSessions } from "@/server/coach-sessions.ts"

/**
 * One session — **a stub in this ticket, deliberately** (#61).
 *
 * The list rows and Today's cards have to be able to lead somewhere
 * complete-looking now, and #62 develops this into the real screen with
 * reschedule, cancel and the artifact list. The alternative — pointing every row
 * at the client route until then — keeps each screen honest and makes the list
 * feel like a dead end.
 *
 * So: the facts, and **no actions**. Nothing here can fail, and nothing here
 * promises anything the next two tickets have not built.
 */
export function SessionScreen({
  copy,
  language,
  session,
}: {
  readonly copy: CoachCopy
  readonly language: CoachLanguage
  readonly session: CoachSessions.SessionDetail
}) {
  const moment = sessionMoment(language, new Date(session.scheduledAt), session.timezone)

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <TelegramBackButton label={copy.common.back} fallbackTo="/sessions" />

      <header className="mt-2">
        <h1 className="text-title font-semibold tracking-tight">{copy.sessions.detailTitle}</h1>
        <p className="text-muted-foreground mt-1 text-body">
          {moment.day}
          {", "}
          <span className="tabular-nums">{moment.time}</span>
          {" ("}
          {moment.offset}
          {")"}
        </p>
      </header>

      <DetailCard className="mt-8">
        <DetailRow label={copy.sessions.detailClient}>
          {/* The one link on the screen, and not an action: everything a coach
              can do about this client lives on their own route. */}
          <Link
            to="/clients/$clientId"
            params={{ clientId: session.clientId }}
            className="text-primary"
          >
            {session.clientName}
          </Link>
        </DetailRow>
        <DetailRow label={copy.sessions.detailKind}>
          <SessionKindLine
            copy={copy.clients}
            kind={session.kind}
            durationMinutes={session.durationMinutes}
            className="text-foreground justify-end text-body"
          />
        </DetailRow>
        {/*
          The invitation appears only when it is a problem. A healthy session
          says nothing about its client's state — a row reading "accepted" on
          every session would train the eye to skip the one that does not.
        */}
        {session.clientAccepted ? null : (
          <DetailRow label={copy.sessions.detailInvitation}>
            <span className="text-warning">{copy.sessions.detailUnaccepted}</span>
          </DetailRow>
        )}
      </DetailCard>
    </main>
  )
}
