import { ClientRepo, MemberRepo, SessionRepo, WorkspaceRepo } from "@praximo/db"
import {
  type BusyInterval,
  ClientInviteDeliveryKind,
  ClientInviteTokenAlphabet,
  ClientInviteTokenLength,
  ClientInviteTtlMillis,
  clientBrandMarkUrl,
  clientInviteStartParameter,
  clientInviteUrl,
  type CoachLanguage,
  CreateClientInput,
  type DayWindow,
  isClientInviteDeliveryKind,
  isSupportedTimeZone,
  MinutesInDay,
  nextSlotStart,
  parseWorkingHours,
  readEmailAddress,
  readMemberSettings,
  readWorkingHours,
  type SessionCancelReason,
  SessionKind,
  type SessionState,
  sessionStillAhead,
  windowForWeekday,
  type WorkingHours,
  type WorkspaceId,
} from "@praximo/domain"
import { EmailChannel } from "@praximo/email"
import { clientCopy } from "@praximo/i18n"
import { BotRegistry } from "@praximo/telegram"
import { Clock, Config, Context, Effect, Layer, Schema } from "effect"
import { CoachSession, READ_WINDOW_MILLIS, WRITE_WINDOW_MILLIS } from "./coach-session.ts"
import { localParts, nextDate } from "@/lib/coach-calendar.ts"
import { busyByDate, instantOf, weekdayOfDate, zoneOf } from "./coach-day.ts"
import { sessionDraft } from "./session-draft.ts"
import type { LaunchCredential } from "@/launch-credential.ts"

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

/**
 * What the coach actually handed over, and when (#224).
 *
 * Absent until the first successful share or copy, which is what the list and
 * the client's own screen read to say «Не отправлено» rather than «Приглашён»
 * about a link still sitting on the coach's screen.
 */
export interface InviteDelivery {
  /** ISO string, because this crosses a server-function boundary. */
  readonly at: string
  readonly kind: ClientInviteDeliveryKind
}

export interface ClientSummary {
  readonly id: string
  readonly name: string
  /**
   * Whether to ask this row's avatar route for bytes, or draw initials (#231).
   *
   * Presence and never the key: the route resolves that itself, workspace-scoped, so
   * no object key reaches a payload. And a flag rather than letting every disc try
   * and 404 — a roster is mostly people with no photo, and that would be a request
   * per row to learn nothing.
   */
  readonly hasAvatar: boolean
  readonly state: "invited" | "expired" | "accepted"
  /** ISO strings, because this crosses a server-function boundary. */
  readonly invitedAt: string
  readonly inviteExpiresAt: string
  readonly acceptedAt?: string
  readonly delivered?: InviteDelivery
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

/**
 * One way to hand an invitation over: the address, and the sentence it travels
 * in.
 *
 * The message is written to the client in the invitation's own language, with
 * the link on the end (#181). Assembled here rather than on each screen because
 * there are several ways to send it — the bot-authored card, the
 * `t.me/share/url` fallback, a paste into WhatsApp — and one invitation may not
 * say several different things. The card is the exception that proves it: it
 * drops this string's last line because its link is a button, and it builds that
 * from the same copy rather than from a second sentence.
 *
 * Each door ends its message with **its own** URL, which is the whole reason
 * this is a pair rather than one string beside two links.
 */
export interface InviteDoor {
  readonly url: string
  readonly message: string
}

/**
 * The three answers a coach can act on after pressing send (#58).
 *
 * Three and no more, because there is no fourth thing they could do about it.
 * `invalid-address` is the only one that asks them to retype — everything the
 * channel could not classify as the address's fault reaches them as
 * `unavailable`, since telling somebody to fix an address that was fine is worse
 * than telling them to wait. `gone` is the screen having gone stale: the client
 * accepted, or the link lapsed and the shipped reissue path (#61) owns what
 * happens next.
 */
export type SendInviteEmailOutcome =
  /**
   * Carries nothing back. The address the coach needs to *see* is the one the
   * re-read puts on the screen beside «отправлено письмом», which is what the
   * database actually holds; echoing it from here would be a second copy that
   * could disagree with the first.
   */
  | { readonly sent: true }
  | { readonly sent: false; readonly reason: "invalid-address" | "unavailable" | "gone" }

export interface ClientSessionSummary {
  readonly id: string
  readonly scheduledAt: string
  readonly durationMinutes: number
  readonly kind: string
}

/**
 * A session this client and coach have already had, or already called off
 * (#232).
 *
 * The state is what makes the row worth showing: an entry in a history that
 * does not say whether it happened is a date the coach has to remember for
 * themselves.
 */
export interface PastClientSession extends ClientSessionSummary {
  readonly state: SessionState
  /** Absent on every state but `cancelled`. */
  readonly cancelReason?: SessionCancelReason
}

export interface ClientDetail {
  readonly id: string
  readonly name: string
  /** See {@link ClientSummary.hasAvatar}. */
  readonly hasAvatar: boolean
  readonly state: "invited" | "expired" | "accepted"
  readonly language?: CoachLanguage
  readonly createdAt: string
  readonly invite?: {
    readonly token: string
    readonly status: "pending" | "accepted" | "expired"
    readonly expiresAt: string
    readonly language: CoachLanguage
    /**
     * One token, two doors (#224) — the Telegram deep link and the web URL of
     * the Acceptance Page, both assembled here so no screen has to know either
     * shape, and both valid from the moment the invitation exists. The segment
     * on the client's screen chooses which one is shown; it mutates nothing,
     * because there is nothing to mutate.
     */
    readonly telegram: InviteDoor
    readonly link: InviteDoor
    /**
     * The address this invitation was last emailed to (#58), surviving a reissue
     * so the sheet opens pre-filled rather than blank.
     *
     * Independent of `delivered` below: a coach who emailed and then copied the
     * link has a `link` delivery and this address, and both are true.
     */
    readonly address?: string
    /** Absent until the coach actually handed one of them over. */
    readonly delivered?: InviteDelivery
  }
  readonly channel?: {
    readonly kind: string
    readonly telegramUsername?: string
    readonly telegramName?: string
  }
  readonly acceptedAt?: string
  readonly consentGrantedAt?: string
  /**
   * What is still ahead of this client, soonest first — and **only** that.
   *
   * The field keeps its meaning from #56 because two things read it and both
   * mean «live, ahead»: the scheduling screen dots its month with these days so
   * the coach can place a rhythm, and a past day is not bookable; and the intake
   * switch asks whether this is a first session, which `past` now answers the
   * other half of.
   */
  readonly sessions: ReadonlyArray<ClientSessionSummary>
  /** Everything else, newest first — the history the route shows below (#232). */
  readonly past: ReadonlyArray<PastClientSession>
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
  /**
   * The coach's own hours for this weekday (#210), absent when they do not work
   * it at all.
   *
   * Resolved here rather than on the screen because the weekday a date falls on
   * is the coach's zone's business, and that lives on this side — the same
   * reason `busy` arrives as minutes-of-day rather than as instants.
   */
  readonly working?: DayWindow
  readonly timezone: string
}

/**
 * One day of a range read, carrying the date it answers for.
 *
 * The strip offers a fortnight and the coach walks along it, so asking day by
 * day is fourteen round-trips and fourteen queries for a few dozen intervals.
 * The range is one of each; the browser files the answers per day.
 */
export interface DatedDaySchedule extends DaySchedule {
  /** `YYYY-MM-DD` in the coach's own zone. */
  readonly date: string
}

/**
 * The longest range one read will answer for. The strip grows to a quarter but
 * asks in fortnights, and a request for a year is a bug rather than a coach.
 */
export const MaxRangeDays = 31

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
 *
 * **The Telegram door, and only that one**, unlike the client's own screen since
 * #224. This answers one action — the card on an unaccepted session (#61), which
 * goes out through Telegram's picker — and a second URL here would be a door
 * with no control behind it. Choosing between the two is what the client's
 * screen is for.
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
  readonly rangeSchedule: (
    credential: LaunchCredential,
    from: string,
    days: number,
  ) => Effect.Effect<
    ReadonlyArray<DatedDaySchedule>,
    CoachSession.Unauthenticated | CoachSession.LoadFailed
  >
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
  /**
   * Write down that the coach handed this invitation over (#224).
   *
   * `{ recorded: false }` is every reason there was nothing to write: a kind
   * this product does not deliver through, a client of another workspace, an
   * invitation already accepted. The browser reports a delivery; it never
   * decides one, and it is not told which of those it hit — the screen re-reads
   * itself either way.
   */
  readonly recordDelivery: (
    credential: LaunchCredential,
    clientId: string,
    kind: unknown,
  ) => Effect.Effect<
    { readonly recorded: boolean },
    CoachSession.Unauthenticated | CoachSession.LoadFailed
  >
  /**
   * Send this client their invitation by email (#58).
   *
   * The one delivery the *service* performs rather than the coach, which is why
   * it is an operation here and not a position on the door segment: the other
   * two doors hand a token to a person, and this one hands it to an address.
   *
   * Synchronous by design. The coach is standing in front of the screen when
   * they press it, and an outbox would answer them five minutes later into
   * nothing. Nothing is written until Cloudflare has accepted the message, so a
   * failure leaves the invitation exactly as it was and pressing again is safe.
   */
  readonly sendInviteEmail: (
    credential: LaunchCredential,
    clientId: string,
    address: unknown,
  ) => Effect.Effect<SendInviteEmailOutcome, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  /** Written silently on launch, with no UI and no answer worth waiting for. */
  readonly saveTimezone: (
    credential: LaunchCredential,
    timezone: string,
  ) => Effect.Effect<void, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  readonly hideMainMiniAppHint: (
    credential: LaunchCredential,
  ) => Effect.Effect<void, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  /** The week the coach works (#210) — the default until they say otherwise. */
  readonly workingHours: (
    credential: LaunchCredential,
  ) => Effect.Effect<WorkingHours, CoachSession.Unauthenticated | CoachSession.LoadFailed>
  /**
   * Commits a whole week at once. `false` means the value was not one this
   * product could have produced and nothing was written — never a silent reset.
   */
  readonly saveWorkingHours: (
    credential: LaunchCredential,
    input: unknown,
  ) => Effect.Effect<
    { readonly saved: boolean },
    CoachSession.Unauthenticated | CoachSession.LoadFailed
  >
}

export class Service extends Context.Service<Service, Interface>()("@praximo/coach/CoachClients") {}

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

// Intentionally stays caller-owned in #236: these Client/Invite/Session ids
// cross CoachClients repository operations and migrate with those operations.
const identifier = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`

const iso = (value: Date): string => value.toISOString()

/**
 * The delivery record on its way to a screen (#224), as the optional field it
 * lands in.
 *
 * The kind is narrowed rather than passed through: the column is an open `text`
 * and a value this deploy has no word for is not a door the screen can name.
 * Dropping the record then reads as «Не отправлено», which is the honest answer
 * to "we cannot tell what happened" — the alternative is a row saying
 * «отправлено» followed by a raw identifier.
 */
const delivered = (
  record: { readonly at: Date; readonly kind: string } | undefined,
): { readonly delivered?: InviteDelivery } =>
  record === undefined || !isClientInviteDeliveryKind(record.kind)
    ? {}
    : { delivered: { at: iso(record.at), kind: record.kind } }

const failed = (operation: string) => () => new CoachSession.LoadFailed({ operation })

/**
 * One client's calendar, cut into the two fields the route reads (#232).
 *
 * The repository hands over the whole thing newest first, and the cut is made
 * here with `sessionStillAhead` — the same predicate the sessions list is cut
 * along — so the two surfaces cannot come to disagree about what «past» means.
 *
 * The floor is **this minute**, not the start of the day as on the flat list.
 * That difference is deliberate and both are right: the list is about a coach's
 * day and shows the whole of it, while these sessions dot a month the coach is
 * about to book into, and a morning that has gone is not a day they can place
 * anything on.
 *
 * Ahead comes back ascending — the repository's order reversed — because that
 * list is read as «what happens next», while a history is read from the most
 * recent thing backwards.
 */
const splitSessions = (
  rows: ReadonlyArray<ClientRepo.ClientSessionRow>,
  now: Date,
): {
  readonly sessions: ReadonlyArray<ClientSessionSummary>
  readonly past: ReadonlyArray<PastClientSession>
} => {
  const ahead: Array<ClientSessionSummary> = []
  const behind: Array<PastClientSession> = []
  for (const entry of rows) {
    const summary = {
      id: entry.id,
      scheduledAt: iso(entry.scheduledAt),
      durationMinutes: entry.durationMinutes,
      kind: entry.kind,
    }
    if (sessionStillAhead(entry.state, entry.scheduledAt, now)) {
      ahead.push(summary)
      continue
    }
    behind.push({
      ...summary,
      state: entry.state,
      ...(entry.cancelReason === undefined ? {} : { cancelReason: entry.cancelReason }),
    })
  }
  // In-place is safe and intended: the array was built two lines up and nothing
  // else holds it, and the ES2022 target has no `toReversed` to build it again.
  // oxlint-disable-next-line unicorn/no-array-reverse
  return { sessions: ahead.reverse(), past: behind }
}

/**
 * The hours a coach works on one of their own calendar dates (#210).
 *
 * A date whose weekday cannot be read falls back on the shared window rather
 * than on "not working": a day the sheet cannot classify should offer the
 * ordinary grid, not an empty one.
 */
const workingWindowOn = (hours: WorkingHours, date: string): DayWindow | undefined => {
  const weekday = weekdayOfDate(date)
  return weekday === undefined ? hours.window : windowForWeekday(hours, weekday)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* CoachSession.Service
    const clients = yield* ClientRepo.Service
    const sessions = yield* SessionRepo.Service
    const members = yield* MemberRepo.Service
    const registry = yield* BotRegistry.Service
    const workspaces = yield* WorkspaceRepo.Service
    const email = yield* EmailChannel.Service
    // Read once, at layer construction, exactly as `CoachSurface` reads it for
    // the legal texts: the client app's origin is a deployment fact rather than
    // a per-call one, and a stage that cannot address its own Acceptance Page
    // should fail where that is visible rather than on a coach's screen.
    const clientOrigin = yield* Config.string("CLIENT_APP_URL")

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
          hasAvatar: row.hasAvatar,
          state: row.state,
          invitedAt: iso(row.invitedAt),
          inviteExpiresAt: iso(row.inviteExpiresAt),
          ...(row.acceptedAt === undefined ? {} : { acceptedAt: iso(row.acceptedAt) }),
          ...delivered(row.delivered),
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
      // The one place a name-bearing sentence is assembled for this screen, and
      // skipped entirely for a client who has already accepted — there is no
      // message left to send them.
      const coach = invite === undefined ? "" : yield* coachName(principal.workspaceId)
      /**
       * Both doors of the one token (#224), built together so neither can drift.
       *
       * The body is the same sentence either way — it says who is writing and
       * why, not which app to open — and only the link on the end differs. The
       * paste channel has no button, so the link travels in the body;
       * `shareInviteMessage` strips that last line back off for the
       * `t.me/share/url` form, where it is the `url` parameter.
       */
      const doors =
        invite === undefined
          ? undefined
          : (() => {
              const body = invitationBody(invite.language, row.name, coach)
              const door = (url: string) => ({ url, message: `${body}\n\n${url}` })
              return {
                telegram: door(
                  `https://t.me/${principal.botUsername}?start=${clientInviteStartParameter(
                    invite.token,
                  )}`,
                ),
                link: door(clientInviteUrl(clientOrigin, invite.token)),
              }
            })()

      return {
        id: row.id,
        name: row.name,
        hasAvatar: row.hasAvatar,
        state: row.state,
        ...(row.language === undefined ? {} : { language: row.language }),
        createdAt: iso(row.createdAt),
        ...(invite === undefined || doors === undefined
          ? {}
          : {
              invite: {
                token: invite.token,
                status: invite.status,
                expiresAt: iso(invite.expiresAt),
                language: invite.language,
                telegram: doors.telegram,
                link: doors.link,
                ...(invite.address === undefined ? {} : { address: invite.address }),
                ...delivered(invite.delivered),
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
        ...splitSessions(row.sessions, now),
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
      const hours = readWorkingHours(readMemberSettings(principal.settings).workingHours)
      const working = workingWindowOn(hours, date)

      return {
        busy: booked.map((entry) => {
          const start = localParts(entry.scheduledAt, timezone).minutes
          return { startMinutes: start, endMinutes: start + entry.durationMinutes }
        }),
        ...(here.date === date ? { earliestStartMinutes: nextSlotStart(here.minutes) } : {}),
        ...(working === undefined ? {} : { working }),
        timezone,
      } satisfies DaySchedule
    })

    /**
     * The same answer for a run of consecutive days, in one query.
     *
     * The strip the coach walks along offers a fortnight, and a day at a time
     * meant a round-trip and a query per glance. One window, one read, filed per
     * day here rather than in the browser — which day an instant falls on is the
     * coach's zone's business, and that lives on this side.
     *
     * A session that started the previous day and runs into the first one is
     * outside the window, exactly as it is for `daySchedule`: the two must agree,
     * because the browser caches whichever answered first.
     */
    const rangeSchedule = Effect.fn("CoachClients.rangeSchedule")(function* (
      credential: LaunchCredential,
      from: string,
      days: number,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      const timezone = zoneOf(principal)
      const span = Math.max(1, Math.min(Math.trunc(days), MaxRangeDays))

      const dates: Array<string> = []
      let cursor = from
      for (let index = 0; index < span; index++) {
        dates.push(cursor)
        cursor = nextDate(cursor)
      }

      const start = instantOf(from, 0, timezone)
      // The midnight *after* the last day, so the window is closed by a day
      // boundary rather than by a minute count that a clock change would move.
      const end = instantOf(cursor, 0, timezone)
      if (start === undefined || end === undefined) return []

      const booked = yield* sessions
        .between(principal.workspaceId, start, end)
        .pipe(Effect.mapError(failed("sessions.between")))

      const busy = busyByDate(booked, timezone)

      const now = new Date(yield* Clock.currentTimeMillis)
      const here = localParts(now, timezone)
      const hours = readWorkingHours(readMemberSettings(principal.settings).workingHours)

      return dates.map((date) => {
        const working = workingWindowOn(hours, date)
        return {
          date,
          busy: busy.get(date) ?? [],
          ...(here.date === date ? { earliestStartMinutes: nextSlotStart(here.minutes) } : {}),
          ...(working === undefined ? {} : { working }),
          timezone,
        }
      }) satisfies ReadonlyArray<DatedDaySchedule>
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
      if (kind === undefined) return { scheduled: false, reason: "invalid" } as const

      const now = yield* Clock.currentTimeMillis
      // The three questions a single draft can answer on its own, shared with
      // the reschedule write so `invalid` and `past` cannot come to mean two
      // different things on two screens (#62).
      const draft = sessionDraft({
        date: input.date,
        startMinutes: input.startMinutes,
        durationMinutes: input.durationMinutes,
        timezone: zoneOf(principal),
        nowMillis: now,
      })
      if (!draft.ok) return { scheduled: false, reason: draft.reason } as const

      const outcome = yield* sessions
        .schedule({
          workspaceId: principal.workspaceId,
          clientId: input.clientId,
          sessionId: identifier("se"),
          scheduledAt: draft.at,
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
          url: existing.invite.telegram.url,
          message: existing.invite.telegram.message,
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
        url: fresh.invite.telegram.url,
        message: fresh.invite.telegram.message,
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

    /**
     * The delivery, written down (#224).
     *
     * Reported by the browser because only the browser knows what happened —
     * whether the picker actually sent, whether the clipboard write resolved —
     * and decided nowhere else: the invitation is resolved from the coach's own
     * workspace, so the only thing the tap gets to name is which client it was
     * looking at and which door it used.
     *
     * A kind this product does not deliver through is refused without a write
     * rather than stored. `delivery.kind` is read by the screen to name the door
     * in a sentence, and a value nothing has a word for would surface as a raw
     * identifier in the middle of one.
     */
    const recordDelivery = Effect.fn("CoachClients.recordDelivery")(function* (
      credential: LaunchCredential,
      clientId: string,
      kind: unknown,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(ClientInviteDeliveryKind)(kind).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      if (decoded === undefined) return { recorded: false } as const

      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const now = new Date(yield* Clock.currentTimeMillis)
      return yield* clients
        .recordDelivery({
          workspaceId: principal.workspaceId,
          clientId,
          kind: decoded,
          now,
        })
        .pipe(Effect.mapError(failed("clients.recordDelivery")))
    })

    /**
     * The service-sent invitation (#58).
     *
     * **Nothing is written before Cloudflare accepts the message** — not the
     * address, not the kind, not the moment. That is the same rule the
     * Acceptance Page's commit follows, and here it is what makes a retry safe:
     * a failed send leaves the invitation byte-for-byte as it was, so pressing
     * the button again cannot produce a second delivery record for a message
     * that never left.
     *
     * The bookkeeping **afterwards** is best-effort, for the same reason
     * `recordDelivery` is on the coach's own share and more strongly: by then the
     * message has left and cannot be unsent. A failed write turning a real send
     * into a reported failure would invite the coach to send a second email to a
     * client who already has one. It surfaces instead as «не отправлено» beside a
     * client who did get their invitation — an understatement, which is the safe
     * direction for this screen to be wrong in (#224).
     */
    const sendInviteEmail = Effect.fn("CoachClients.sendInviteEmail")(function* (
      credential: LaunchCredential,
      clientId: string,
      address: unknown,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const to = typeof address === "string" ? readEmailAddress(address) : undefined
      if (to === undefined) return { sent: false, reason: "invalid-address" } as const

      const existing = yield* detailFor(principal, clientId)
      // An invitation that has been accepted, or one whose link has lapsed —
      // the latter belongs to the reissue path (#61), which is already on the
      // screen. Either way the screen re-reads itself and finds out which.
      if (existing?.invite === undefined || existing.state !== "invited") {
        return { sent: false, reason: "gone" } as const
      }

      const coach = yield* coachName(principal.workspaceId)
      const outcome = yield* email
        .sendClientInvite({
          to,
          locale: existing.invite.language,
          coachName: coach,
          // The Link door's URL, because that is what this is: the same door,
          // sent by us instead of pasted by them.
          acceptanceUrl: existing.invite.link.url,
          markUrl: clientBrandMarkUrl(clientOrigin),
        })
        .pipe(
          Effect.as("sent" as const),
          // One cascade over the whole union: two of the three reach the coach
          // as the same word, and splitting them across two combinators only
          // hid how few answers there really are.
          Effect.catchTags({
            "EmailChannel.AddressRejected": () => Effect.succeed("invalid-address" as const),
            "EmailChannel.SenderNotConfigured": () => Effect.succeed("unavailable" as const),
            "EmailChannel.SendFailed": () => Effect.succeed("unavailable" as const),
          }),
        )
      if (outcome !== "sent") return { sent: false, reason: outcome } as const

      const now = new Date(yield* Clock.currentTimeMillis)
      yield* clients
        .recordDelivery({
          workspaceId: principal.workspaceId,
          clientId,
          kind: "email",
          address: to,
          now,
        })
        .pipe(Effect.ignore)
      return { sent: true } as const
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

    const workingHours = Effect.fn("CoachClients.workingHours")(function* (
      credential: LaunchCredential,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, READ_WINDOW_MILLIS)
      return readWorkingHours(readMemberSettings(principal.settings).workingHours)
    })

    /**
     * The whole week, written at once.
     *
     * Parsed strictly rather than read tolerantly: a request this server cannot
     * understand leaves the stored week alone. The alternative — falling back —
     * would answer a malformed write by resetting a coach's hours to the
     * default, which is the one outcome nobody asked for.
     */
    const saveWorkingHours = Effect.fn("CoachClients.saveWorkingHours")(function* (
      credential: LaunchCredential,
      input: unknown,
    ) {
      const principal = yield* session.requireOnboardedCoach(credential, WRITE_WINDOW_MILLIS)
      const hours = parseWorkingHours(input)
      if (hours === undefined) return { saved: false } as const

      const now = new Date(yield* Clock.currentTimeMillis)
      yield* members
        .saveSettings({
          memberId: principal.memberId,
          // Merged rather than replaced, like every other write to this blob: a
          // key from a newer deploy must survive this one saying its piece.
          settings: { ...readMemberSettings(principal.settings), workingHours: hours },
          now,
        })
        .pipe(Effect.mapError(failed("member.saveSettings")))
      return { saved: true } as const
    })

    return Service.of({
      home,
      create,
      detail,
      daySchedule,
      rangeSchedule,
      schedule,
      remove,
      resetInvite,
      resendInvite,
      prepareInviteCard,
      recordDelivery,
      sendInviteEmail,
      saveTimezone,
      hideMainMiniAppHint,
      workingHours,
      saveWorkingHours,
    })
  }),
)

export * as CoachClients from "./coach-clients.ts"
