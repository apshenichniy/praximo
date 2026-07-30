import type { WorkingHours } from "@praximo/domain"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { CoachClients } from "./coach-clients.ts"
import { coachInput, TransportNumber, TransportString, TransportValue } from "./coach-operation.ts"
import type { CoachResult } from "./coach-transport.ts"
import { launchCredential } from "@/launch-credential.ts"
import { coachAcknowledgement, coachOperation } from "./runtime.server.ts"

/**
 * The client screens' transport: a tagged result rather than a thrown error, and
 * one undifferentiated `unauthenticated` so a refusal cannot be used to tell an
 * unknown bot from a stale credential. The mapping itself is shared (#61), and
 * since #234 so is everything around it — each operation below is the service
 * call, the shape of its answer, and nothing else.
 */

/** The one shape read on both sides of every client operation. */
const clientIdInput = Schema.Struct({ clientId: TransportString })

export type CoachClientsResult = CoachResult<{
  readonly home: CoachClients.CoachClientsHome
}>

export const listClients = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(
    coachOperation({
      run: (credential) => Effect.flatMap(CoachClients.Service, (s) => s.home(credential)),
      answer: (home): CoachClientsResult => ({ ok: true, home }),
    }),
  )

export type ClientDetailResult = CoachResult<{
  readonly client: CoachClients.ClientDetail | undefined
}>

export const getClient = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(clientIdInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof clientIdInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.detail(credential, data.clientId)),
      answer: (client): ClientDetailResult => ({ ok: true, client }),
    }),
  )

export type CreateClientResult = CoachResult<{ readonly clientId: string }, "invalid">

/**
 * The New client screen's single commit. The name and the invitation language
 * travel as plain strings and are decoded against the domain schema on the
 * server — the screen offers a text field and three chips, so anything else is
 * a broken client.
 */
const createClientInput = Schema.Struct({
  name: TransportString,
  inviteLanguage: TransportString,
})

export const createClient = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(createClientInput))
  .handler(
    coachOperation({
      failures: { "CoachClients.InvalidClient": "invalid" },
      run: (credential, data: typeof createClientInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.create(credential, data)),
      answer: (created): CreateClientResult => ({ ok: true, clientId: created.clientId }),
    }),
  )

export type DayScheduleResult = CoachResult<{ readonly day: CoachClients.DaySchedule }>

const dayScheduleInput = Schema.Struct({ date: TransportString })

export const getDaySchedule = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(dayScheduleInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof dayScheduleInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.daySchedule(credential, data.date)),
      answer: (day): DayScheduleResult => ({ ok: true, day }),
    }),
  )

export type RangeScheduleResult = CoachResult<{
  readonly days: ReadonlyArray<CoachClients.DatedDaySchedule>
}>

/**
 * A run of days in one read (#186). The strip asks for the fortnight it shows
 * rather than for each day the thumb reaches, so walking it costs one round-trip
 * instead of fourteen — and the days themselves are a handful of intervals, so
 * the answer is smaller than the requests it replaces.
 */
const rangeScheduleInput = Schema.Struct({ from: TransportString, days: TransportNumber(1) })

export const getRangeSchedule = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(rangeScheduleInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof rangeScheduleInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) =>
          s.rangeSchedule(credential, data.from, data.days),
        ),
      answer: (days): RangeScheduleResult => ({ ok: true, days }),
    }),
  )

export type ScheduleResult = CoachResult<{ readonly outcome: CoachClients.ScheduleOutcome }>

const scheduleInput = Schema.Struct({
  clientId: TransportString,
  date: TransportString,
  startMinutes: TransportNumber(-1),
  durationMinutes: TransportNumber(-1),
  kind: TransportString,
})

export const scheduleSession = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(scheduleInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof scheduleInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.schedule(credential, data)),
      answer: (outcome): ScheduleResult => ({ ok: true, outcome }),
    }),
  )

export type DeleteClientResult = CoachResult<{ readonly deleted: boolean }>

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(clientIdInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof clientIdInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.remove(credential, data.clientId)),
      answer: ({ deleted }): DeleteClientResult => ({ ok: true, deleted }),
    }),
  )

export const resetInvite = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(clientIdInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof clientIdInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.resetInvite(credential, data.clientId)),
      answer: (client): ClientDetailResult => ({ ok: true, client }),
    }),
  )

export type ResendInviteResult = CoachResult<{ readonly outcome: CoachClients.ResendOutcome }>

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
  .validator(coachInput(clientIdInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof clientIdInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.resendInvite(credential, data.clientId)),
      answer: (outcome): ResendInviteResult => ({ ok: true, outcome }),
    }),
  )

/**
 * `gone` is the invitation that is no longer shareable — deleted, accepted, or
 * reissued out from under the screen. `failed` is the coach's own bot refusing
 * to author the card, which the same tap can retry.
 */
export type PrepareInviteCardResult = CoachResult<
  { readonly card: CoachClients.PreparedInviteCard },
  "gone" | "failed"
>

/**
 * The card, minted on the coach's tap (#179).
 *
 * A `POST` like every other client operation, and authenticated the same way:
 * the invitation is resolved server-side from the coach's own workspace, so the
 * only thing the browser gets to name is which client it is looking at.
 */
export const prepareInviteCard = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(clientIdInput))
  .handler(
    coachOperation({
      failures: { "CoachClients.CardPreparationFailed": "failed" },
      run: (credential, data: typeof clientIdInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.prepareInviteCard(credential, data.clientId)),
      answer: (card): PrepareInviteCardResult =>
        card === undefined ? { ok: false, error: "gone" } : { ok: true, card },
    }),
  )

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
const recordDeliveryInput = Schema.Struct({ clientId: TransportString, kind: TransportString })

export const recordInviteDelivery = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(recordDeliveryInput))
  .handler(
    coachAcknowledgement({
      run: (credential, data: typeof recordDeliveryInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) =>
          s.recordDelivery(credential, data.clientId, data.kind),
        ),
      acknowledged: ({ recorded }) => recorded,
    }),
  )

export type SendInviteEmailResult = CoachResult<{
  readonly outcome: CoachClients.SendInviteEmailOutcome
}>

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
const sendInviteEmailInput = Schema.Struct({
  clientId: TransportString,
  address: TransportString,
})

export const sendInviteEmail = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(sendInviteEmailInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof sendInviteEmailInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) =>
          s.sendInviteEmail(credential, data.clientId, data.address),
        ),
      answer: (outcome): SendInviteEmailResult => ({ ok: true, outcome }),
    }),
  )

/**
 * The zone, sent on launch and answered with nothing.
 *
 * There is no UI behind this and nothing on screen depends on the reply: a
 * failed write means the next launch tries again, which is exactly the right
 * amount of ceremony for a column nobody asked to fill in.
 */
const timezoneInput = Schema.Struct({ timezone: TransportString })

export const saveTimezone = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(timezoneInput))
  .handler(
    coachAcknowledgement({
      run: (credential, data: typeof timezoneInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.saveTimezone(credential, data.timezone)),
      acknowledged: () => true,
    }),
  )

export const hideMainMiniAppHint = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(
    coachAcknowledgement({
      run: (credential) =>
        Effect.flatMap(CoachClients.Service, (s) => s.hideMainMiniAppHint(credential)),
      acknowledged: () => true,
    }),
  )

export type WorkingHoursResult = CoachResult<{ readonly hours: WorkingHours }>

export const getWorkingHours = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(
    coachOperation({
      run: (credential) => Effect.flatMap(CoachClients.Service, (s) => s.workingHours(credential)),
      answer: (hours): WorkingHoursResult => ({ ok: true, hours }),
    }),
  )

/**
 * The screen commits on change, so this is called once per tap rather than once
 * per visit — and the answer matters, unlike `saveTimezone`: a coach who cannot
 * see that a change failed will keep the week they think they set.
 *
 * The value crosses unread on purpose and is parsed strictly on the far side. A
 * reader here that fell back would turn a mangled request into a silent reset,
 * which is the one failure this write must not have.
 */
const workingHoursInput = Schema.Struct({ hours: TransportValue })

export const saveWorkingHours = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(workingHoursInput))
  .handler(
    coachAcknowledgement({
      run: (credential, data: typeof workingHoursInput.Type) =>
        Effect.flatMap(CoachClients.Service, (s) => s.saveWorkingHours(credential, data.hours)),
      acknowledged: ({ saved }) => saved,
    }),
  )
