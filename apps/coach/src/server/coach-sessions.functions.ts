import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { coachInput, TransportString } from "./coach-operation.ts"
import { CoachSessions } from "./coach-sessions.ts"
import type { CoachResult } from "./coach-transport.ts"
import { launchCredential } from "./launch-credential.ts"
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

export type UpcomingSessionsResult = CoachResult<{
  readonly upcoming: CoachSessions.UpcomingSessions
}>

export const listUpcomingSessions = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(
    coachOperation({
      run: (credential) => Effect.flatMap(CoachSessions.Service, (s) => s.upcoming(credential)),
      answer: (upcoming): UpcomingSessionsResult => ({ ok: true, upcoming }),
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
