import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { coachInput, TransportNumber, TransportString } from "./coach-operation.ts"
import { CoachSessions } from "./coach-sessions.ts"
import type { CoachResult } from "./coach-transport.ts"
import { launchCredential } from "@/launch-credential.ts"
import { coachOperation } from "./runtime.server.ts"

/** Today, the sessions list and one session, as transport (#61). */
export type TodayResult = CoachResult<{ readonly today: CoachSessions.TodayView }>

export const loadToday = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(
    coachOperation({
      run: (credential) => Effect.flatMap(CoachSessions.Service, (s) => s.today(credential)),
      answer: (today): TodayResult => ({ ok: true, today }),
    }),
  )

/** Both views of the list in one answer — the segment switches, it does not fetch (#232). */
export type SessionsListResult = CoachResult<{ readonly list: CoachSessions.SessionsList }>

export const listSessions = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(
    coachOperation({
      run: (credential) => Effect.flatMap(CoachSessions.Service, (s) => s.list(credential)),
      answer: (list): SessionsListResult => ({ ok: true, list }),
    }),
  )

export type SessionDetailResult = CoachResult<{
  readonly session: CoachSessions.SessionDetail | undefined
}>

const sessionIdInput = Schema.Struct({ sessionId: TransportString })

export const getSession = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(sessionIdInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof sessionIdInput.Type) =>
        Effect.flatMap(CoachSessions.Service, (s) => s.detail(credential, data.sessionId)),
      answer: (session): SessionDetailResult => ({ ok: true, session }),
    }),
  )

/**
 * The move and the cancellation (#62), as transport.
 *
 * Both carry their refusal *inside* a successful answer rather than as a word on
 * the wire, exactly as `scheduleSession` and `deleteClient` already do: «this
 * slot is taken» is something the operation decided, not a failure of it, and
 * the screen has a sentence for each.
 */
export type RescheduleResult = CoachResult<{
  readonly outcome: CoachSessions.RescheduleOutcome
}>

const rescheduleInput = Schema.Struct({
  sessionId: TransportString,
  date: TransportString,
  startMinutes: TransportNumber(-1),
  durationMinutes: TransportNumber(-1),
})

export const rescheduleSession = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(rescheduleInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof rescheduleInput.Type) =>
        Effect.flatMap(CoachSessions.Service, (s) => s.reschedule(credential, data)),
      answer: (outcome): RescheduleResult => ({ ok: true, outcome }),
    }),
  )

export type CancelSessionResult = CoachResult<{ readonly cancelled: boolean }>

export const cancelSession = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(sessionIdInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof sessionIdInput.Type) =>
        Effect.flatMap(CoachSessions.Service, (s) => s.cancel(credential, data.sessionId)),
      answer: ({ cancelled }): CancelSessionResult => ({ ok: true, cancelled }),
    }),
  )
