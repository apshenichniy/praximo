import type { CoachLanguage, SessionCancelReason } from "@praximo/domain"
import { sessionMoment } from "@praximo/i18n"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { HostBackButton } from "@/mini-app.tsx"
import { Card } from "@praximo/ui/components/card"
import { Heading, Section, Text } from "@praximo/ui"
import { SessionKindLine } from "@/features/coach/components/session-kind-line.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import type { SessionsCopy } from "@/features/i18n/coach-copy/sessions.ts"
import { ConfirmSheet } from "@/features/mini-app/components/confirm-sheet.tsx"
import { DetailCard, DetailRow } from "@/features/mini-app/components/detail-card.tsx"
import type { CoachSessions } from "@/server/coach-sessions.ts"

/**
 * One session: the facts, what became of it, and the two things a coach can do
 * to it (#62 — #61 shipped this as a deliberate stub).
 *
 * The screen is built around a rule it inherits from the invitation row: an
 * ordinary session says **nothing** about itself. A status line on every session
 * is a line the eye learns to skip, and the one that matters would go with it.
 * So the state speaks only when the session is not `scheduled`, and the actions
 * disappear at exactly the moment they stop meaning anything.
 */

/**
 * What became of the session, as a sentence.
 *
 * `undefined` for a session still scheduled — which is what keeps the row off an
 * ordinary screen — and for `in_progress`, whose whole story is happening in the
 * room right now and belongs to #42 rather than to a past-tense line.
 */
export const stateSentence = (
  copy: SessionsCopy,
  state: CoachSessions.SessionDetail["state"],
  reason: SessionCancelReason | undefined,
): string | undefined => {
  if (state === "completed") return copy.stateCompleted
  if (state !== "cancelled") return undefined
  // A cancellation with no reason on file cannot exist — every writer sets one —
  // but reading an unknown one as the reconciler's would put words in its mouth,
  // so anything else falls back to the coach's own.
  if (reason === "no_show") return copy.stateCancelledNoShow
  if (reason === "room_unavailable") return copy.stateCancelledRoom
  return copy.stateCancelledByCoach
}

export function SessionScreen({
  copy,
  language,
  session,
  onCancel,
  pending,
  error,
}: {
  readonly copy: CoachCopy
  readonly language: CoachLanguage
  readonly session: CoachSessions.SessionDetail
  readonly onCancel: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const [confirmCancel, setConfirmCancel] = useState(false)
  const moment = sessionMoment(language, new Date(session.scheduledAt), session.timezone)
  const standing = stateSentence(copy.sessions, session.state, session.cancelReason)
  /**
   * Both actions are offered on exactly the state that can take them. A running
   * session ends through the room (#42), and a terminal one is a record.
   */
  const actionable = session.state === "scheduled"

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <HostBackButton label={copy.common.back} fallbackTo="/sessions" />

      <header className="mt-2">
        <Heading as="h1" role="page-title">
          {copy.sessions.detailTitle}
        </Heading>
        <Text className="text-muted-foreground mt-1">
          {moment.day}
          {", "}
          <span className="tabular-nums">{moment.time}</span>
          {" ("}
          {moment.offset}
          {")"}
        </Text>
      </header>

      <DetailCard className="mt-8">
        <DetailRow label={copy.sessions.detailClient}>
          {/* The one link among the facts, and not an action: everything a coach
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
            className="text-foreground justify-end text-base leading-relaxed"
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
        {/*
          And the same rule for the session itself. An automatic cancellation
          carries no warning colour: it is what happened, not something the coach
          has to do anything about.
        */}
        {standing === undefined ? null : (
          <DetailRow label={copy.sessions.detailState}>{standing}</DetailRow>
        )}
      </DetailCard>

      {/*
        Two ordinary rows rather than a danger zone. Cancelling is a routine part
        of running a practice — clients move, coaches fall ill — and putting it
        under the destructive heading would spend that heading's weight on the
        commonest thing here, leaving none for Reset and Delete on the client
        route, which really are the end of something.

        And deliberately not the host's fixed bottom slot: that is where #42's
        Join goes, and an action parked there now would have to be evicted.
      */}
      {!actionable ? null : (
        <Section>
          <Card className="mt-4 gap-0 overflow-hidden py-0">
            <ul className="divide-border divide-y">
              <li>
                <Link
                  to="/sessions/$sessionId/reschedule"
                  params={{ sessionId: session.id }}
                  className="transition-colors duration-100 active:bg-muted flex min-h-11 w-full items-center px-5 py-4 text-base leading-relaxed font-semibold"
                >
                  {copy.sessions.rescheduleAction}
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirmCancel(true)}
                  className="text-destructive transition-colors duration-100 active:bg-muted flex min-h-11 w-full items-center px-5 py-4 text-left text-base leading-relaxed font-semibold disabled:opacity-60"
                >
                  {copy.sessions.cancelAction}
                </button>
              </li>
            </ul>
          </Card>
          {error === undefined ? null : <Text className="text-destructive mt-3">{error}</Text>}
        </Section>
      )}

      <ConfirmSheet
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={copy.sessions.cancelTitle}
        description={copy.sessions.cancelBody}
        cancelLabel={copy.clients.cancel}
        confirmLabel={copy.sessions.cancelConfirm}
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmCancel(false)
          onCancel()
        }}
      />
    </main>
  )
}
