import { createServerFn } from "@tanstack/react-start"
import type { CoachSessions } from "./coach-sessions.ts"
import { type CoachTransportError, transportError } from "./coach-transport.ts"
import { launchCredential } from "./launch-credential.ts"
import {
  loadCoachSessionDetail,
  loadCoachToday,
  loadCoachUpcomingSessions,
} from "./runtime.server.ts"

/** Today, the sessions list and one session, as transport (#61). */
export type CoachSessionsTransportError = CoachTransportError

export type TodayResult =
  | { readonly ok: true; readonly today: CoachSessions.TodayView }
  | { readonly ok: false; readonly error: CoachSessionsTransportError }

export const loadToday = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(async ({ context }): Promise<TodayResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, today: await loadCoachToday(context.credential) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type UpcomingSessionsResult =
  | { readonly ok: true; readonly upcoming: CoachSessions.UpcomingSessions }
  | { readonly ok: false; readonly error: CoachSessionsTransportError }

export const listUpcomingSessions = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(async ({ context }): Promise<UpcomingSessionsResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, upcoming: await loadCoachUpcomingSessions(context.credential) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type SessionDetailResult =
  | { readonly ok: true; readonly session: CoachSessions.SessionDetail | undefined }
  | { readonly ok: false; readonly error: CoachSessionsTransportError }

export const getSession = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): { readonly sessionId: string } => ({
    sessionId:
      typeof input === "object" &&
      input !== null &&
      "sessionId" in input &&
      typeof input.sessionId === "string"
        ? input.sessionId
        : "",
  }))
  .handler(async ({ context, data }): Promise<SessionDetailResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, session: await loadCoachSessionDetail(context.credential, data.sessionId) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })
