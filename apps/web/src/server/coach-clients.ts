import { ClientRepo, MemberRepo, SessionRepo, WorkspaceRepo } from "@praximo/db"
import {
  type BusyInterval,
  ClientInviteTokenAlphabet,
  ClientInviteTokenLength,
  ClientInviteTtlMillis,
  clientInviteStartParameter,
  type CoachLanguage,
  CreateClientInput,
  isSchedulableStart,
  isSupportedTimeZone,
  nextSlotStart,
  PlannedDurations,
  readMemberSettings,
  SessionKind,
  type WorkspaceId,
} from "@praximo/domain"
import { clientCopy } from "@praximo/i18n"
import { BotRegistry } from "@praximo/telegram"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { CoachSession, READ_WINDOW_MILLIS, WRITE_WINDOW_MILLIS } from "./coach-session.ts"
import { instantOf, localParts, MinutesInDay } from "@/lib/coach-calendar.ts"
import { zoneOf } from "./coach-zone.ts"
import type { LaunchCredential } from "./launch-credential.ts"

/**
 * The coach's clients: the list they land on, the one they create, the one they
 * open, and the session they book (#56).
 *
 * A service of its own rather than more of `CoachSurface`, per the seam rule
 * (#38): the entry answers "who is this coach and what screen do they get",
 * which is a different question from "what is in their practice", and the two
 * would otherwise share nothing but the credential.
 *
 * Every operation here goes through `requireOnboardedCoach`, so the tenant key
 * is produced by authentication rather than accepted from the caller — a client
 * id from another workspace reads as "no such client" at the repository, and
 * that is the second fence rather than the first.
 */

export interface ClientSummary {
  readonly id: string
  readonly name: string
  readonly state: "invited" | "expired" | "accepted"
  /** ISO strings, because this crosses a server-function boundary. */
  readonly invitedAt: string
  readonly inviteExpiresAt: string
  readonly acceptedAt?: string
}

export interface CoachClientsHome {
  readonly clients: ReadonlyArray<ClientSummary>
  /**
   * Whether the Main Mini App hint still has a job. It disappears on its own
   * once Telegram reports `has_main_web_app` — the daily sweep writes a fresh
   * `botInfo` (#55) — and the coach can hide it by hand, which lands in
   * `member.settings`.
   */
  readonly mainMiniAppHintVisible: boolean
}

export interface ClientSessionSummary {
  readonly id: string
  readonly scheduledAt: string
  readonly durationMinutes: number
  readonly kind: string
}

export interface ClientDetail {
  readonly id: string
  readonly name: string
  readonly state: "invited" | "expired" | "accepted"
  readonly language?: CoachLanguage
  readonly createdAt: string
  readonly invite?: {
    readonly token: string
    readonly status: "pending" | "accepted" | "expired"
    readonly expiresAt: string
    readonly language: CoachLanguage
    /** The whole door, assembled here so no screen has to know its shape. */
    readonly url: string
    /**
     * The forwardable message, written to the client in the invitation's own
     * language, with the link on the end (#181).
     *
     * Assembled here rather than on each screen because there are three ways to
     * send it — the bot-authored card, the `t.me/share/url` fallback, and a
     * paste into WhatsApp — and one invitation may not say three different
     * things. The card is the exception that proves it: it drops this string's
     * last line because its link is a button, and it builds that from the same
     * copy rather than from a second sentence.
     */
    readonly message: string
  }
  readonly channel?: {
    readonly kind: string
    readonly telegramUsername?: string
    readonly telegramName?: string
  }
  readonly acceptedAt?: string
  readonly consentGrantedAt?: string
  readonly sessions: ReadonlyArray<ClientSessionSummary>
  readonly canDelete: boolean
  /** The zone every time on this screen is written in — the coach's own. */
  readonly timezone: string
}

export interface DaySchedule {
  /** Minutes-of-day the coach is already booked for, in their own zone. */
  readonly busy: ReadonlyArray<BusyInterval>
  /**
   * The first minute-of-day still worth offering. Present only when the day
   * being asked about is today in the coach's zone.
   */
  readonly earliestStartMinutes?: number
  readonly timezone: string
}

export interface ScheduleSessionInput {
  readonly clientId: string
  /** `YYYY-MM-DD` as the coach's own calendar reads it. */
  readonly date: string
  readonly startMinutes: number
  readonly durationMinutes: number
  readonly kind: string
}

export type ScheduleOutcome =
  | { readonly scheduled: true }
  | {
      readonly scheduled: false
      readonly reason: "overlap" | "past" | "invalid" | "unknown-client"
    }

/**
 * A prepared inline message, minted on the coach's tap and handed straight to
 * Telegram's chat picker (#179).
 *
 * `expiresAt` is Telegram's own `expiration_date`, carried through rather than
 * assumed: the browser decides from it whether the id is still worth sharing,
 * and asks again if it is not.
 */
export interface PreparedInviteCard {
  readonly preparedMessageId: string
  /** ISO string, because this crosses a server-function boundary. */
  readonly expiresAt: string
}

/**
 * What the resend action gets back: the invitation to hand to Telegram's picker,
 * or the reason there is nothing to send.
 *
 * `reissued` is reported rather than assumed, so the screen can say a fresh link
 * was minted — a coach who resends a dead invitation has just invalidated
 * whatever the client was holding, even though it no longer worked.
 */
export type ResendOutcome =
  | {
      readonly resent: true
      readonly reissued: boolean
      readonly url: string
      readonly message: string
    }
  | { readonly resent: false; readonly reason: "accepted" | "unknown-client" }

export interface Interface {
  readonly home: (
    credential: LaunchCredential,
  ) => Effect.Effect<CoachClientsHome, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly create: (
    credential: LaunchCredential,
    input: unknown,
  ) => Effect.Effect<
    { readonly clientId: string },
    CoachSession.Unauthenticated | CoachSession.LoadFailed | InvalidClient
  >
  readonly detail: (
    credential: LaunchCredential,
    clientId: string,
  ) => Effect.Effect<
    ClientDetail | undefined,
    CoachSession.Unauthenticated | CoachSession.LoadFailed
  >
  readonly daySchedule: (
    credential: LaunchCredential,
    date: string,
  ) => Effect.Effect<DaySchedule, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly schedule: (
    credential: LaunchCredential,
    input: ScheduleSessionInput,
  ) => Effect.Effect<ScheduleOutcome, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly remove: (
    credential: LaunchCredential,
    clientId: string,
  ) => Effect.Effect<
    { readonly deleted: boolean },
    CoachSession.Unauthenticated | CoachSession.LoadFailed
  >
  readonly resetInvite: (
    credential: LaunchCredential,
    clientId: string,
  ) => Effect.Effect<
    ClientDetail | undefined,
    CoachSession.Unauthenticated | CoachSession.LoadFailed
  >
  /**
   * Recovery rather than reset (#61): hand back an invitation this client can
   * still be sent, minting a fresh one **only** when the one on file has lapsed.
   *
   * Reset is destructive by definition — it kills a link the client is holding —
   * and this is its mirror case: a coach looking at a session whose client never
   * accepted wants to send the invitation again, and if that link is already
   * dead there is nothing left to destroy by replacing it.
   */
  readonly resendInvite: (
    credential: LaunchCredential,
    clientId: string,
  ) => Effect.Effect<ResendOutcome, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  /**
   * `undefined` when there is no invitation left to share — the client was
   * deleted, or accepted between the screen drawing and the tap.
   */
  readonly prepareInviteCard: (
    credential: LaunchCredential,
    clientId: string,
  ) => Effect.Effect<
    PreparedInviteCard | undefined,
    CoachSession.Unauthenticated | CoachSession.LoadFailed | CardPreparationFailed
  >
  /** Written silently on launch, with no UI and no answer worth waiting for. */
  readonly saveTimezone: (
    credential: LaunchCredential,
    timezone: string,
  ) => Effect.Effect<void, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly hideMainMiniAppHint: (
    credential: LaunchCredential,
  ) => Effect.Effect<void, CoachSession.Unauthenticated | CoachSession.LoadFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/web/CoachClients") {}

/** A name or an invitation language the New client screen cannot have produced. */
export class InvalidClient extends Schema.TaggedErrorClass<InvalidClient>()(
  "CoachClients.InvalidClient",
  {},
) {}

/**
 * The coach's bot could not author the card. Retryable by definition: the
 * invitation is untouched, and everything that gets here — a Telegram hiccup, a
 * credential mid-repair, a bot that needs re-linking — is answered by tapping
 * again or by the sub-8.0 form beside it.
 */
export class CardPreparationFailed extends Schema.TaggedErrorClass<CardPreparationFailed>()(
  "CoachClients.CardPreparationFailed",
  {},
) {}

/**
 * What the client reads, in the language the coach chose for them (#181).
 *
 * The coach's own language never reaches this: the New client screen asks for an
 * invitation language and says what it is for, and a screen that collects an
 * answer and ignores it is worse than one that never asked.
 *
 * The coach is named by their workspace label — the same name their bot
 * introduces itself with throughout the acceptance conversation, so the client
 * meets one assistant rather than two.
 */
const invitationBody = (language: CoachLanguage, client: string, coach: string): string =>
  clientCopy(language).invitation.message({ client, coach })

/**
 * A readable identifier, drawn from the same alphabet as the coach's code so a
 * client reading a link out loud has no `0`/`O` to get wrong. Twelve symbols:
 * this one also travels in a web URL (#57), where guessing is parallel.
 */
const mintToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(ClientInviteTokenLength))
  return Array.from(
    bytes,
    (byte) => ClientInviteTokenAlphabet[byte % ClientInviteTokenAlphabet.length] ?? "2",
  ).join("")
}

const identifier = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`

const iso = (value: Date): string => value.toISOString()

const failed = (operation: string) => () => new CoachSession.LoadFailed({ operation })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* CoachSession.Service
    const clients = yield* ClientRepo.Service
    const sessions = yield* SessionRepo.Service
    const members = yield* MemberRepo.Service
    const registry = yield* BotRegistry.Service
    const workspaces = yield* WorkspaceRepo.Service

    /**
     * How the client is told who this is. The workspace label is the coach's
     * name everywhere in the client's journey — the bot reads the same column
     * when it introduces itself — so the invitation and the conversation it
     * opens name the same person.
     *
     * Read only for a client who still has an invitation to send, and allowed to
     * fail the screen: an authenticated coach whose workspace cannot be read has
     * lost more than a sentence, and an invitation addressed by nobody is worse
     * than a retry.
     */
    const coachName = Effect.fn("CoachClients.coachName")(function* (workspaceId: WorkspaceId) {
      const workspace = yield* workspaces
        .findById(workspaceId)
        .pipe(Effect.mapError(failed("workspace.findById")))
      return workspace.name
    })

    const home = Effect.fn("CoachClients.home")(function* (credential: LaunchCredential) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      const rows = yield* clients
        .list(principal.workspaceId, now)
        .pipe(Effect.mapError(failed("clients.list")))

      const settings = readMemberSettings(principal.settings)
      return {
        clients: rows.map((row) => ({
          id: row.id,
          name: row.name,
          state: row.state,
          invitedAt: iso(row.invitedAt),
          inviteExpiresAt: iso(row.inviteExpiresAt),
          ...(row.acceptedAt === undefined ? {} : { acceptedAt: iso(row.acceptedAt) }),
        })),
        // Two ways off the screen, and neither is a button that can be lied to:
        // Telegram's own `has_main_web_app`, refreshed by the daily sweep, and
        // the coach's deliberate Hide.
        mainMiniAppHintVisible:
          settings.mainMiniAppHintDismissed !== true && !principal.hasMainMiniApp,
      } satisfies CoachClientsHome
    })

    const detailFor = Effect.fn("CoachClients.detailFor")(function* (
      principal: CoachSession.CoachPrincipal,
      clientId: string,
    ) {
      const now = new Date(yield* Clock.currentTimeMillis)
      const row = yield* clients
        .find(principal.workspaceId, clientId, now)
        .pipe(Effect.mapError(failed("clients.find")))
      if (row === undefined) return undefined

      const invite = row.invite
      const url =
        invite === undefined
          ? undefined
          : `https://t.me/${principal.botUsername}?start=${clientInviteStartParameter(invite.token)}`
      // The one place a name-bearing sentence is assembled for this screen, and
      // skipped entirely for a client who has already accepted — there is no
      // message left to send them.
      const coach = invite === undefined ? "" : yield* coachName(principal.workspaceId)

      return {
        id: row.id,
        name: row.name,
        state: row.state,
        ...(row.language === undefined ? {} : { language: row.language }),
        createdAt: iso(row.createdAt),
        ...(invite === undefined || url === undefined
          ? {}
          : {
              invite: {
                token: invite.token,
                status: invite.status,
                expiresAt: iso(invite.expiresAt),
                language: invite.language,
                url,
                // The paste channel has no button, so the link travels in the
                // body. `shareInviteMessage` strips this last line back off for
                // the `t.me/share/url` form, where it is the `url` parameter.
                message: `${invitationBody(invite.language, row.name, coach)}\n\n${url}`,
              },
            }),
        ...(row.channel === undefined
          ? {}
          : {
              channel: {
                kind: row.channel.kind,
                ...(row.channel.telegramUsername === undefined
                  ? {}
                  : { telegramUsername: row.channel.telegramUsername }),
                ...(row.channel.telegramName === undefined
                  ? {}
                  : { telegramName: row.channel.telegramName }),
              },
            }),
        ...(row.acceptedAt === undefined ? {} : { acceptedAt: iso(row.acceptedAt) }),
        ...(row.consentGrantedAt === undefined
          ? {}
          : { consentGrantedAt: iso(row.consentGrantedAt) }),
        sessions: row.sessions.map((entry) => ({
          id: entry.id,
          scheduledAt: iso(entry.scheduledAt),
          durationMinutes: entry.durationMinutes,
          kind: entry.kind,
        })),
        canDelete: row.canDelete,
        timezone: zoneOf(principal),
      } satisfies ClientDetail
    })

    const detail = Effect.fn("CoachClients.detail")(function* (
      credential: LaunchCredential,
      clientId: string,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      return yield* detailFor(principal, clientId)
    })

    /**
     * One screen, one commit. The client and the invitation are created
     * together, so the seven-day window starts here rather than at delivery —
     * the coach entering five existing clients at once has five windows running,
     * and Reissue is the answer to that.
     */
    const create = Effect.fn("CoachClients.create")(function* (
      credential: LaunchCredential,
      input: unknown,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(CreateClientInput)(input).pipe(
        Effect.mapError(() => new InvalidClient()),
      )
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      const clientId = identifier("cl")

      yield* clients
        .createWithInvite({
          workspaceId: principal.workspaceId,
          clientId,
          inviteId: identifier("iv"),
          name: decoded.name,
          token: mintToken(),
          inviteLanguage: decoded.inviteLanguage,
          now,
          expiresAt: new Date(now.getTime() + ClientInviteTtlMillis),
        })
        .pipe(Effect.mapError(failed("clients.createWithInvite")))

      return { clientId }
    })

    /**
     * What the sheet needs to draw one day: the coach's own bookings as
     * minutes-of-day, and — only when the day being asked about is today — the
     * first minute still worth offering.
     *
     * The window is computed from the coach's zone rather than from UTC, so a
     * coach in Kyiv asking about Monday is asking about Monday where they are.
     */
    const daySchedule = Effect.fn("CoachClients.daySchedule")(function* (
      credential: LaunchCredential,
      date: string,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      const timezone = zoneOf(principal)
      const from = instantOf(date, 0, timezone)
      const to = instantOf(date, MinutesInDay, timezone)
      if (from === undefined || to === undefined) return { busy: [], timezone }

      const booked = yield* sessions
        .between(principal.workspaceId, from, to)
        .pipe(Effect.mapError(failed("sessions.between")))
      const now = new Date(yield* Clock.currentTimeMillis)
      const here = localParts(now, timezone)

      return {
        busy: booked.map((entry) => {
          const start = localParts(entry.scheduledAt, timezone).minutes
          return { startMinutes: start, endMinutes: start + entry.durationMinutes }
        }),
        ...(here.date === date ? { earliestStartMinutes: nextSlotStart(here.minutes) } : {}),
        timezone,
      } satisfies DaySchedule
    })

    /**
     * The booking itself, refused in four different ways.
     *
     * `invalid` and `past` are decided here because they are decidable here: a
     * start off the quarter-hour grid, a duration the product does not plan, or
     * a time that has already gone by needs no query. `overlap` needs the
     * workspace's own day and is refused by the insert. The screen never offers
     * any of them — this is what happens when something else does.
     */
    const schedule = Effect.fn("CoachClients.schedule")(function* (
      credential: LaunchCredential,
      input: ScheduleSessionInput,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const kind = yield* Schema.decodeUnknownEffect(SessionKind)(input.kind).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      if (
        kind === undefined ||
        !PlannedDurations.includes(input.durationMinutes as never) ||
        !isSchedulableStart(input.startMinutes, input.durationMinutes)
      ) {
        return { scheduled: false, reason: "invalid" } as const
      }

      const timezone = zoneOf(principal)
      const scheduledAt = instantOf(input.date, input.startMinutes, timezone)
      if (scheduledAt === undefined) return { scheduled: false, reason: "invalid" } as const

      const now = yield* Clock.currentTimeMillis
      if (scheduledAt.getTime() <= now) return { scheduled: false, reason: "past" } as const

      const outcome = yield* sessions
        .schedule({
          workspaceId: principal.workspaceId,
          clientId: input.clientId,
          sessionId: identifier("se"),
          scheduledAt,
          durationMinutes: input.durationMinutes,
          kind,
          now: new Date(now),
        })
        .pipe(Effect.mapError(failed("sessions.schedule")))

      return outcome.scheduled
        ? ({ scheduled: true } as const)
        : ({ scheduled: false, reason: outcome.reason } as const)
    })

    const remove = Effect.fn("CoachClients.remove")(function* (
      credential: LaunchCredential,
      clientId: string,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      return yield* clients
        .deleteUnaccepted(principal.workspaceId, clientId)
        .pipe(Effect.mapError(failed("clients.deleteUnaccepted")))
    })

    /**
     * Mint a fresh invitation for a client this coach owns, and say whether it
     * took. Shared by the deliberate Reset and by recovery (#61), because the
     * two differ in what they *mean*, not in what they write.
     */
    const reissueFor = Effect.fn("CoachClients.reissueFor")(function* (
      principal: CoachSession.CoachPrincipal,
      clientId: string,
      now: Date,
      fallbackLanguage: CoachLanguage,
    ) {
      const reissued = yield* clients
        .reissueInvite({
          workspaceId: principal.workspaceId,
          clientId,
          inviteId: identifier("iv"),
          token: mintToken(),
          inviteLanguage: fallbackLanguage,
          now,
          expiresAt: new Date(now.getTime() + ClientInviteTtlMillis),
        })
        .pipe(Effect.mapError(failed("clients.reissueInvite")))
      return reissued !== undefined
    })

    /**
     * A fresh invitation, and the detail screen re-read through the same path
     * that drew it. Echoing the new token back would leave the rest of the
     * screen speaking for a state that no longer exists.
     */
    const resetInvite = Effect.fn("CoachClients.resetInvite")(function* (
      credential: LaunchCredential,
      clientId: string,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      const existing = yield* clients
        .find(principal.workspaceId, clientId, now)
        .pipe(Effect.mapError(failed("clients.find")))
      if (existing === undefined) return undefined

      // The repository refuses once the client has accepted — there is no door
      // left to reopen. Handing the screen a detail it did not ask for would
      // read as success.
      const reissued = yield* reissueFor(
        principal,
        clientId,
        now,
        existing.invite?.language ?? principal.language,
      )
      if (!reissued) return undefined

      return yield* detailFor(principal, clientId)
    })

    /**
     * The invitation, ready to send again — reissued only if the one on file is
     * dead (#61).
     *
     * This is what stops the resend action on an unaccepted session's card from
     * dead-ending: the state it exists for is exactly the state where the link
     * on file no longer opens anything, and a screen that offered "send it
     * again" and then handed over a dead URL would be worse than no action.
     */
    const resendInvite = Effect.fn("CoachClients.resendInvite")(function* (
      credential: LaunchCredential,
      clientId: string,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      const existing = yield* detailFor(principal, clientId)
      if (existing === undefined) return { resent: false, reason: "unknown-client" } as const
      // Nothing to send: the client walked through the door already, and the
      // screen that offered this has simply gone stale.
      if (existing.state === "accepted") {
        return { resent: false, reason: "accepted" } as const
      }

      if (existing.state !== "expired" && existing.invite !== undefined) {
        return {
          resent: true,
          reissued: false,
          url: existing.invite.url,
          message: existing.invite.message,
        } as const
      }

      const reissued = yield* reissueFor(
        principal,
        clientId,
        now,
        existing.invite?.language ?? principal.language,
      )
      if (!reissued) return { resent: false, reason: "accepted" } as const

      const fresh = yield* detailFor(principal, clientId)
      if (fresh?.invite === undefined) {
        return { resent: false, reason: "unknown-client" } as const
      }
      return {
        resent: true,
        reissued: true,
        url: fresh.invite.url,
        message: fresh.invite.message,
      } as const
    })

    /**
     * The share step (#179): ask the coach's own bot to author the invitation
     * card, and hand its short-lived id back for `WebApp.shareMessage`.
     *
     * Minted on the tap and never ahead of it — prepared messages expire — which
     * is why this is an operation of its own rather than another field on the
     * detail the screen already loaded.
     *
     * The body is the same string `detailFor` puts on the screen, from the same
     * catalogue and the same language, minus its last line: here the link is the
     * button, and repeating it would only make the card longer and scarier
     * (#164).
     */
    const prepareInviteCard = Effect.fn("CoachClients.prepareInviteCard")(function* (
      credential: LaunchCredential,
      clientId: string,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      const row = yield* clients
        .find(principal.workspaceId, clientId, now)
        .pipe(Effect.mapError(failed("clients.find")))
      // Nothing to share: no such client for this coach, or a token that no
      // longer opens anything — accepted, or replaced by a reissue the screen
      // has not caught up to. A window that has merely run out is *not* refused
      // here: that token still reaches the bot, which answers it politely, and
      // the form beside this one would share it either way.
      if (row?.invite === undefined || row.invite.status !== "pending") return undefined

      const language = row.invite.language
      const coach = yield* coachName(principal.workspaceId)
      const prepared = yield* registry
        .prepareCard(principal.workspaceId, {
          title: row.name,
          text: invitationBody(language, row.name, coach),
          buttonText: clientCopy(language).invitation.button,
          buttonUrl: `https://t.me/${principal.botUsername}?start=${clientInviteStartParameter(
            row.invite.token,
          )}`,
        })
        .pipe(Effect.mapError(() => new CardPreparationFailed()))

      return {
        preparedMessageId: prepared.id,
        expiresAt: iso(prepared.expiresAt),
      } satisfies PreparedInviteCard
    })

    const saveTimezone = Effect.fn("CoachClients.saveTimezone")(function* (
      credential: LaunchCredential,
      timezone: string,
    ) {
      if (!isSupportedTimeZone(timezone)) return
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      if (principal.timezone === timezone) return
      const now = new Date(yield* Clock.currentTimeMillis)
      yield* members
        .setTimezone({ memberId: principal.memberId, timezone, now })
        .pipe(Effect.mapError(failed("member.setTimezone")))
    })

    const hideMainMiniAppHint = Effect.fn("CoachClients.hideMainMiniAppHint")(function* (
      credential: LaunchCredential,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      yield* members
        .saveSettings({
          memberId: principal.memberId,
          // Merged rather than replaced: a key written by a newer deploy must
          // survive this one saying its own piece.
          settings: { ...readMemberSettings(principal.settings), mainMiniAppHintDismissed: true },
          now,
        })
        .pipe(Effect.mapError(failed("member.saveSettings")))
    })

    return Service.of({
      home,
      create,
      detail,
      daySchedule,
      schedule,
      remove,
      resetInvite,
      resendInvite,
      prepareInviteCard,
      saveTimezone,
      hideMainMiniAppHint,
    })
  }),
)

export * as CoachClients from "./coach-clients.ts"
