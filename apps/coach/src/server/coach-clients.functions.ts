import type { WorkingHours } from "@praximo/domain"
import { createServerFn } from "@tanstack/react-start"
import type { CoachClients } from "./coach-clients.ts"
import { type CoachTransportError, isTagged, transportError } from "./coach-transport.ts"
import { launchCredential } from "./launch-credential.ts"
import {
  createCoachClient,
  hideCoachMainMiniAppHint,
  loadCoachClientDetail,
  loadCoachClients,
  loadCoachDaySchedule,
  loadCoachRangeSchedule,
  loadCoachWorkingHours,
  prepareCoachInviteCard,
  recordCoachInviteDelivery,
  removeCoachClient,
  resendCoachClientInvite,
  resetCoachClientInvite,
  saveCoachTimezone,
  saveCoachWorkingHours,
  scheduleCoachSession,
  sendCoachInviteEmail,
} from "./runtime.server.ts"

/**
 * The client screens' transport: a tagged result rather than a thrown error, and
 * one undifferentiated `unauthenticated` so a refusal cannot be used to tell an
 * unknown bot from a stale credential. The mapping itself is shared (#61).
 */
export type CoachClientsTransportError = CoachTransportError

export type CoachClientsResult =
  | { readonly ok: true; readonly home: CoachClients.CoachClientsHome }
  | { readonly ok: false; readonly error: CoachClientsTransportError }

export const listClients = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(async ({ context }): Promise<CoachClientsResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, home: await loadCoachClients(context.credential) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type ClientDetailResult =
  | { readonly ok: true; readonly client: CoachClients.ClientDetail | undefined }
  | { readonly ok: false; readonly error: CoachClientsTransportError }

const clientIdOf = (input: unknown): { readonly clientId: string } => ({
  clientId:
    typeof input === "object" &&
    input !== null &&
    "clientId" in input &&
    typeof input.clientId === "string"
      ? input.clientId
      : "",
})

export const getClient = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(clientIdOf)
  .handler(async ({ context, data }): Promise<ClientDetailResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, client: await loadCoachClientDetail(context.credential, data.clientId) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type CreateClientResult =
  | { readonly ok: true; readonly clientId: string }
  | { readonly ok: false; readonly error: CoachClientsTransportError | "invalid" }

/**
 * The New client screen's single commit. The name and the invitation language
 * travel as plain strings and are decoded against the domain schema on the
 * server — the screen offers a text field and three chips, so anything else is
 * a broken client.
 */
export const createClient = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): { readonly name: string; readonly inviteLanguage: string } => ({
    name:
      typeof input === "object" &&
      input !== null &&
      "name" in input &&
      typeof input.name === "string"
        ? input.name
        : "",
    inviteLanguage:
      typeof input === "object" &&
      input !== null &&
      "inviteLanguage" in input &&
      typeof input.inviteLanguage === "string"
        ? input.inviteLanguage
        : "",
  }))
  .handler(async ({ context, data }): Promise<CreateClientResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      const created = await createCoachClient(context.credential, data)
      return { ok: true, clientId: created.clientId }
    } catch (error) {
      if (isTagged(error, "CoachClients.InvalidClient")) return { ok: false, error: "invalid" }
      return { ok: false, error: transportError(error) }
    }
  })

export type DayScheduleResult =
  | { readonly ok: true; readonly day: CoachClients.DaySchedule }
  | { readonly ok: false; readonly error: CoachClientsTransportError }

export const getDaySchedule = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): { readonly date: string } => ({
    date:
      typeof input === "object" &&
      input !== null &&
      "date" in input &&
      typeof input.date === "string"
        ? input.date
        : "",
  }))
  .handler(async ({ context, data }): Promise<DayScheduleResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, day: await loadCoachDaySchedule(context.credential, data.date) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type RangeScheduleResult =
  | { readonly ok: true; readonly days: ReadonlyArray<CoachClients.DatedDaySchedule> }
  | { readonly ok: false; readonly error: CoachClientsTransportError }

/**
 * A run of days in one read (#186). The strip asks for the fortnight it shows
 * rather than for each day the thumb reaches, so walking it costs one round-trip
 * instead of fourteen — and the days themselves are a handful of intervals, so
 * the answer is smaller than the requests it replaces.
 */
export const getRangeSchedule = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): { readonly from: string; readonly days: number } => {
    const record = (input ?? {}) as Record<string, unknown>
    return {
      from: typeof record.from === "string" ? record.from : "",
      days: typeof record.days === "number" && Number.isFinite(record.days) ? record.days : 1,
    }
  })
  .handler(async ({ context, data }): Promise<RangeScheduleResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return {
        ok: true,
        days: await loadCoachRangeSchedule(context.credential, data.from, data.days),
      }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type ScheduleResult =
  | { readonly ok: true; readonly outcome: CoachClients.ScheduleOutcome }
  | { readonly ok: false; readonly error: CoachClientsTransportError }

export const scheduleSession = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): CoachClients.ScheduleSessionInput => {
    const record = (input ?? {}) as Record<string, unknown>
    return {
      clientId: typeof record.clientId === "string" ? record.clientId : "",
      date: typeof record.date === "string" ? record.date : "",
      startMinutes: typeof record.startMinutes === "number" ? record.startMinutes : -1,
      durationMinutes: typeof record.durationMinutes === "number" ? record.durationMinutes : -1,
      kind: typeof record.kind === "string" ? record.kind : "",
    }
  })
  .handler(async ({ context, data }): Promise<ScheduleResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, outcome: await scheduleCoachSession(context.credential, data) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type DeleteClientResult =
  | { readonly ok: true; readonly deleted: boolean }
  | { readonly ok: false; readonly error: CoachClientsTransportError }

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(clientIdOf)
  .handler(async ({ context, data }): Promise<DeleteClientResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      const removed = await removeCoachClient(context.credential, data.clientId)
      return { ok: true, deleted: removed.deleted }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export const resetInvite = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(clientIdOf)
  .handler(async ({ context, data }): Promise<ClientDetailResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, client: await resetCoachClientInvite(context.credential, data.clientId) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type ResendInviteResult =
  | { readonly ok: true; readonly outcome: CoachClients.ResendOutcome }
  | { readonly ok: false; readonly error: CoachClientsTransportError }

/**
 * Recovery behind the resend action (#61): the invitation to send again, minted
 * fresh only when the one on file has lapsed.
 *
 * A `POST` like every other client operation and authenticated the same way —
 * whether a fresh link is needed is decided server-side from the invitation's
 * own state, never from what the screen believed when it drew the button.
 */
export const resendInvite = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(clientIdOf)
  .handler(async ({ context, data }): Promise<ResendInviteResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, outcome: await resendCoachClientInvite(context.credential, data.clientId) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type PrepareInviteCardResult =
  | { readonly ok: true; readonly card: CoachClients.PreparedInviteCard }
  /**
   * `gone` is the invitation that is no longer shareable — deleted, accepted, or
   * reissued out from under the screen. `failed` is the coach's own bot refusing
   * to author the card, which the same tap can retry.
   */
  | { readonly ok: false; readonly error: CoachClientsTransportError | "gone" | "failed" }

/**
 * The card, minted on the coach's tap (#179).
 *
 * A `POST` like every other client operation, and authenticated the same way:
 * the invitation is resolved server-side from the coach's own workspace, so the
 * only thing the browser gets to name is which client it is looking at.
 */
export const prepareInviteCard = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(clientIdOf)
  .handler(async ({ context, data }): Promise<PrepareInviteCardResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      const card = await prepareCoachInviteCard(context.credential, data.clientId)
      return card === undefined ? { ok: false, error: "gone" } : { ok: true, card }
    } catch (error) {
      if (isTagged(error, "CoachClients.CardPreparationFailed"))
        return { ok: false, error: "failed" }
      return { ok: false, error: transportError(error) }
    }
  })

/**
 * The delivery, reported once it has actually happened (#224).
 *
 * Best-effort by design, like the admin section's equivalent: by the time this
 * is called the invitation has already left, so a failure here must never reach
 * the coach as a failed send. It answers `{ ok }` and nothing else — which of
 * the refusals it hit is not a distinction the screen can act on, and the screen
 * re-reads itself either way.
 *
 * The kind crosses as a plain string and is decoded on the far side against the
 * domain's own set: the segment offers two doors, so anything else is a broken
 * client rather than a coach.
 */
export const recordInviteDelivery = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): { readonly clientId: string; readonly kind: string } => {
    const record = (input ?? {}) as Record<string, unknown>
    return {
      clientId: typeof record.clientId === "string" ? record.clientId : "",
      kind: typeof record.kind === "string" ? record.kind : "",
    }
  })
  .handler(async ({ context, data }): Promise<{ readonly ok: boolean }> => {
    if (context.credential.initData.length === 0) return { ok: false }
    try {
      const outcome = await recordCoachInviteDelivery(context.credential, data.clientId, data.kind)
      return { ok: outcome.recorded }
    } catch {
      return { ok: false }
    }
  })

export type SendInviteEmailResult =
  | { readonly ok: true; readonly outcome: CoachClients.SendInviteEmailOutcome }
  | { readonly ok: false; readonly error: CoachClientsTransportError }

/**
 * The invitation, sent by the service (#58).
 *
 * **Not** best-effort like `recordInviteDelivery` beside it, and for the opposite
 * reason: nothing has happened yet when this is called, the coach is waiting for
 * the answer, and the whole point of sending synchronously is that they are told
 * which of the three outcomes they got. A swallowed failure here would leave a
 * client with no invitation and a coach who believes otherwise.
 *
 * The address crosses as a plain string and is validated on the far side against
 * the domain's own reader — the sheet checks it too, but a check on the screen is
 * a courtesy to the typist, never the fence.
 */
export const sendInviteEmail = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): { readonly clientId: string; readonly address: string } => {
    const record = (input ?? {}) as Record<string, unknown>
    return {
      clientId: typeof record.clientId === "string" ? record.clientId : "",
      address: typeof record.address === "string" ? record.address : "",
    }
  })
  .handler(async ({ context, data }): Promise<SendInviteEmailResult> => {
    if (context.credential.initData.length === 0) {
      return { ok: false, error: "unauthenticated" }
    }
    try {
      return {
        ok: true,
        outcome: await sendCoachInviteEmail(context.credential, data.clientId, data.address),
      }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

/**
 * The zone, sent on launch and answered with nothing.
 *
 * There is no UI behind this and nothing on screen depends on the reply: a
 * failed write means the next launch tries again, which is exactly the right
 * amount of ceremony for a column nobody asked to fill in.
 */
export const saveTimezone = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): { readonly timezone: string } => ({
    timezone:
      typeof input === "object" &&
      input !== null &&
      "timezone" in input &&
      typeof input.timezone === "string"
        ? input.timezone
        : "",
  }))
  .handler(async ({ context, data }): Promise<{ readonly ok: boolean }> => {
    if (context.credential.initData.length === 0) return { ok: false }
    try {
      await saveCoachTimezone(context.credential, data.timezone)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

export const hideMainMiniAppHint = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(async ({ context }): Promise<{ readonly ok: boolean }> => {
    if (context.credential.initData.length === 0) return { ok: false }
    try {
      await hideCoachMainMiniAppHint(context.credential)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

export type WorkingHoursResult =
  | { readonly ok: true; readonly hours: WorkingHours }
  | { readonly ok: false; readonly error: CoachClientsTransportError }

export const getWorkingHours = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(async ({ context }): Promise<WorkingHoursResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, hours: await loadCoachWorkingHours(context.credential) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

/**
 * The screen commits on change, so this is called once per tap rather than once
 * per visit — and the answer matters, unlike `saveTimezone`: a coach who cannot
 * see that a change failed will keep the week they think they set.
 *
 * The value crosses unvalidated on purpose and is parsed strictly on the far
 * side. A validator here that fell back would turn a mangled request into a
 * silent reset, which is the one failure this write must not have.
 */
export const saveWorkingHours = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): { readonly hours: unknown } => ({
    hours:
      typeof input === "object" && input !== null && "hours" in input ? input.hours : undefined,
  }))
  .handler(async ({ context, data }): Promise<{ readonly ok: boolean }> => {
    if (context.credential.initData.length === 0) return { ok: false }
    try {
      const outcome = await saveCoachWorkingHours(context.credential, data.hours)
      return { ok: outcome.saved }
    } catch {
      return { ok: false }
    }
  })
