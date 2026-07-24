import type {
  CoachLanguage,
  CoachOnboardingInviteCancellationReason,
  CoachOnboardingInviteStatus,
  InviteDeliveryChannel,
} from "@praximo/domain"
import { Effect } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

export interface DemoInvite {
  readonly id: string
  /** A start-param code from the real alphabet, so the deep link is usable. */
  readonly code: string
  readonly status: CoachOnboardingInviteStatus
  readonly issuedHoursAgo: number
  /** Negative for an invite whose seven-day window has already closed. */
  readonly expiresInHours: number
  readonly delivery?: { readonly channel: InviteDeliveryChannel; readonly language: CoachLanguage }
  readonly acceptedHoursAgo?: number
  /** Claimed by the admin viewing the list, exercising the admin+coach action. */
  readonly acceptedByViewer?: boolean
  readonly usedHoursAgo?: number
  readonly cancelledHoursAgo?: number
  readonly cancellationReason?: CoachOnboardingInviteCancellationReason
}

export interface DemoWorkspace {
  readonly id: string
  readonly name: string
  readonly owner?: {
    readonly id: string
    readonly language: CoachLanguage
    /** Bound at bot connection, not at invite acceptance. */
    readonly telegramUserId?: string
    readonly termsAcceptedHoursAgo?: number
    readonly lastActivityHoursAgo?: number
  }
  readonly bot?: {
    readonly connectionStatus: "awaiting_setup" | "connected" | "needs_relink"
    readonly username?: string
  }
  /** Newest last; the coaches list reads the most recently issued one. */
  readonly invites?: ReadonlyArray<DemoInvite>
}

const Day = 24

/**
 * Deterministic fixtures for the coaches list. Between them they cover every
 * onboarding stage the list can render (#107) — invited over each channel, an
 * invite about to lapse, an accepted claim, a stalled one, a connected bot
 * awaiting activation, an expired invite, a coach decline, an admin reset, a
 * reissue with its cancelled predecessor, and two fully active coaches — plus a
 * workspace that was never invited at all.
 *
 * Bot tokens are always absent, so no fixture can reach Telegram; a fixture may
 * still carry `connected`, because an active coach is exactly what the list has
 * to show. Every fixture is deletable through the admin UI.
 */
export const demoWorkspaces: ReadonlyArray<DemoWorkspace> = [
  { id: "ws_dev_fixture_praximo_lab", name: "Praximo Lab" },
  {
    id: "ws_dev_fixture_ada",
    name: "Ada Lovelace",
    owner: { id: "mem_dev_fixture_ada", language: "en" },
    invites: [
      {
        id: "ci_dev_fixture_ada",
        code: "DEVADA22",
        status: "pending",
        issuedHoursAgo: 20,
        expiresInHours: 6 * Day,
        delivery: { channel: "telegram", language: "en" },
      },
    ],
  },
  {
    id: "ws_dev_fixture_grace",
    name: "Grace Hopper",
    owner: { id: "mem_dev_fixture_grace", language: "ru" },
    invites: [
      {
        id: "ci_dev_fixture_grace",
        code: "DEVGRA33",
        status: "pending",
        issuedHoursAgo: 4 * Day,
        expiresInHours: 3 * Day,
        delivery: { channel: "email", language: "ru" },
      },
    ],
  },
  {
    id: "ws_dev_fixture_katherine",
    name: "Katherine Johnson",
    owner: { id: "mem_dev_fixture_katherine", language: "en" },
    invites: [
      {
        id: "ci_dev_fixture_katherine",
        code: "DEVKAT44",
        status: "pending",
        issuedHoursAgo: 6 * Day + 20,
        expiresInHours: 4,
        delivery: { channel: "copy", language: "uk" },
      },
    ],
  },
  {
    id: "ws_dev_fixture_sofia",
    name: "Sofia Kovalevskaya",
    owner: { id: "mem_dev_fixture_sofia", language: "en" },
    invites: [
      {
        id: "ci_dev_fixture_sofia_old",
        code: "DEVSFA24",
        status: "cancelled",
        issuedHoursAgo: 9 * Day,
        expiresInHours: -2 * Day,
        delivery: { channel: "copy", language: "en" },
        cancelledHoursAgo: 3,
        cancellationReason: "reissued",
      },
      {
        id: "ci_dev_fixture_sofia_new",
        code: "DEVSFA25",
        status: "pending",
        issuedHoursAgo: 3,
        expiresInHours: 7 * Day - 3,
        delivery: { channel: "telegram", language: "en" },
      },
    ],
  },
  {
    id: "ws_dev_fixture_mary",
    name: "Mary Jackson",
    owner: { id: "mem_dev_fixture_mary", language: "en" },
    invites: [
      {
        id: "ci_dev_fixture_mary",
        code: "DEVMAR55",
        status: "accepted",
        issuedHoursAgo: 30,
        expiresInHours: 5 * Day,
        delivery: { channel: "telegram", language: "en" },
        acceptedHoursAgo: 2,
      },
    ],
  },
  {
    id: "ws_dev_fixture_dorothy",
    name: "Dorothy Vaughan",
    owner: { id: "mem_dev_fixture_dorothy", language: "uk" },
    invites: [
      {
        id: "ci_dev_fixture_dorothy",
        code: "DEVDRT66",
        status: "accepted",
        issuedHoursAgo: 5 * Day,
        expiresInHours: 2 * Day,
        delivery: { channel: "email", language: "uk" },
        acceptedHoursAgo: 3 * Day,
      },
    ],
  },
  {
    id: "ws_dev_fixture_annie",
    name: "Annie Easley",
    owner: {
      id: "mem_dev_fixture_annie",
      language: "en",
      telegramUserId: "700000103",
      lastActivityHoursAgo: 1,
    },
    bot: { connectionStatus: "connected", username: "annie_easley_demo_bot" },
    invites: [
      {
        id: "ci_dev_fixture_annie",
        code: "DEVANN77",
        status: "used",
        issuedHoursAgo: 2 * Day,
        expiresInHours: 5 * Day,
        delivery: { channel: "telegram", language: "en" },
        acceptedHoursAgo: 26,
        usedHoursAgo: 1,
      },
    ],
  },
  {
    id: "ws_dev_fixture_melba",
    name: "Melba Roy",
    owner: { id: "mem_dev_fixture_melba", language: "en" },
    invites: [
      {
        id: "ci_dev_fixture_melba",
        code: "DEVMEB88",
        status: "expired",
        issuedHoursAgo: 14 * Day,
        expiresInHours: -7 * Day,
        delivery: { channel: "copy", language: "en" },
      },
    ],
  },
  {
    id: "ws_dev_fixture_evelyn",
    name: "Evelyn Boyd",
    owner: { id: "mem_dev_fixture_evelyn", language: "en" },
    invites: [
      {
        id: "ci_dev_fixture_evelyn",
        code: "DEVEVE99",
        status: "cancelled",
        issuedHoursAgo: 4 * Day,
        expiresInHours: 3 * Day,
        delivery: { channel: "telegram", language: "en" },
        acceptedHoursAgo: 3 * Day,
        cancelledHoursAgo: 2 * Day,
        cancellationReason: "declined_by_coach",
      },
    ],
  },
  {
    id: "ws_dev_fixture_christine",
    name: "Christine Darden",
    owner: { id: "mem_dev_fixture_christine", language: "en" },
    invites: [
      {
        id: "ci_dev_fixture_christine",
        code: "DEVCHR23",
        status: "cancelled",
        issuedHoursAgo: 6 * Day,
        expiresInHours: Day,
        delivery: { channel: "email", language: "en" },
        acceptedHoursAgo: 5 * Day,
        cancelledHoursAgo: 30,
        cancellationReason: "reset_by_admin",
      },
    ],
  },
  {
    id: "ws_dev_fixture_north_star",
    name: "North Star Coaching",
    owner: {
      id: "mem_dev_fixture_north_star",
      language: "en",
      telegramUserId: "700000111",
      termsAcceptedHoursAgo: 20 * Day,
      lastActivityHoursAgo: 2,
    },
    bot: { connectionStatus: "connected", username: "north_star_demo_bot" },
    invites: [
      {
        id: "ci_dev_fixture_north_star",
        code: "DEVNRT26",
        status: "used",
        issuedHoursAgo: 21 * Day,
        expiresInHours: -14 * Day,
        delivery: { channel: "telegram", language: "en" },
        acceptedHoursAgo: 21 * Day,
        usedHoursAgo: 20 * Day,
      },
    ],
  },
  {
    id: "ws_dev_fixture_quiet_harbor",
    name: "Quiet Harbor",
    owner: {
      id: "mem_dev_fixture_quiet_harbor",
      language: "uk",
      telegramUserId: "700000112",
      termsAcceptedHoursAgo: 60 * Day,
      lastActivityHoursAgo: 3 * Day,
    },
    bot: { connectionStatus: "needs_relink", username: "quiet_harbor_demo_bot" },
    invites: [
      {
        id: "ci_dev_fixture_quiet_harbor",
        code: "DEVQHR27",
        status: "used",
        issuedHoursAgo: 61 * Day,
        expiresInHours: -54 * Day,
        delivery: { channel: "copy", language: "uk" },
        acceptedHoursAgo: 61 * Day,
        usedHoursAgo: 60 * Day,
      },
    ],
  },
  {
    id: "ws_dev_fixture_my_practice",
    name: "My coaching practice",
    owner: { id: "mem_dev_fixture_my_practice", language: "en" },
    invites: [
      {
        id: "ci_dev_fixture_my_practice",
        code: "DEVMYP28",
        status: "accepted",
        issuedHoursAgo: 6,
        expiresInHours: 7 * Day - 6,
        delivery: { channel: "telegram", language: "en" },
        acceptedHoursAgo: 4,
        acceptedByViewer: true,
      },
    ],
  },
]

const at = (now: Date, hoursAgo: number): Date => new Date(now.getTime() - hoursAgo * 3_600_000)
const inHours = (now: Date, hours: number): Date => new Date(now.getTime() + hours * 3_600_000)

/**
 * Seed the coaches-list fixtures after a guarded dev reset. Times are relative
 * to `now` so a countdown like "expires in 6d" stays truthful however long the
 * branch has been sitting there. `viewerTelegramId` is the admin the invites are
 * issued by, and the claimant of the admin-as-coach fixture.
 */
export const seedDemoWorkspaces = Effect.fn("DevSeed.seedDemoWorkspaces")(function* (
  now: Date,
  viewerTelegramId: string,
) {
  const { client } = yield* Database.Service

  yield* Effect.tryPromise({
    try: () =>
      client.insert(schema.workspace).values(demoWorkspaces.map(({ id, name }) => ({ id, name }))),
    catch: (cause) => new QueryFailed({ operation: "seedDemoWorkspaces.workspaces", cause }),
  })

  const members = demoWorkspaces.flatMap((workspace) =>
    workspace.owner === undefined
      ? []
      : [
          {
            id: workspace.owner.id,
            workspaceId: workspace.id,
            role: "owner",
            language: workspace.owner.language,
            telegramUserId: workspace.owner.telegramUserId ?? null,
            termsAcceptedAt:
              workspace.owner.termsAcceptedHoursAgo === undefined
                ? null
                : at(now, workspace.owner.termsAcceptedHoursAgo),
            lastLoginAt:
              workspace.owner.termsAcceptedHoursAgo === undefined
                ? null
                : at(now, workspace.owner.termsAcceptedHoursAgo),
            lastActivityAt:
              workspace.owner.lastActivityHoursAgo === undefined
                ? null
                : at(now, workspace.owner.lastActivityHoursAgo),
          },
        ],
  )
  if (members.length > 0) {
    yield* Effect.tryPromise({
      try: () => client.insert(schema.member).values(members),
      catch: (cause) => new QueryFailed({ operation: "seedDemoWorkspaces.members", cause }),
    })
  }

  const bots = demoWorkspaces.flatMap((workspace) =>
    workspace.bot === undefined
      ? []
      : [
          {
            workspaceId: workspace.id,
            connectionStatus: workspace.bot.connectionStatus,
            username: workspace.bot.username ?? null,
            // Never a token: a fixture must not be able to reach Telegram.
            token: null,
          },
        ],
  )
  if (bots.length > 0) {
    yield* Effect.tryPromise({
      try: () => client.insert(schema.bot).values(bots),
      catch: (cause) => new QueryFailed({ operation: "seedDemoWorkspaces.bots", cause }),
    })
  }

  const invites = demoWorkspaces.flatMap((workspace, index) =>
    (workspace.invites ?? []).map((invite, inviteIndex) => ({
      id: invite.id,
      workspaceId: workspace.id,
      requestId: `req_${invite.id}`,
      requestFingerprint: `fingerprint_${invite.id}`,
      code: invite.code,
      issuedByTelegramId: viewerTelegramId,
      delivery: invite.delivery ?? null,
      status: invite.status,
      issuedAt: at(now, invite.issuedHoursAgo),
      expiresAt: inHours(now, invite.expiresInHours),
      acceptedByTelegramId:
        invite.acceptedHoursAgo === undefined
          ? null
          : invite.acceptedByViewer === true
            ? viewerTelegramId
            : // A fictional claimant, distinct per fixture and never a real id.
              String(800_000_000 + index * 10 + inviteIndex),
      acceptedAt: invite.acceptedHoursAgo === undefined ? null : at(now, invite.acceptedHoursAgo),
      usedAt: invite.usedHoursAgo === undefined ? null : at(now, invite.usedHoursAgo),
      cancelledAt:
        invite.cancelledHoursAgo === undefined ? null : at(now, invite.cancelledHoursAgo),
      cancellationReason: invite.cancellationReason ?? null,
    })),
  )
  if (invites.length > 0) {
    yield* Effect.tryPromise({
      try: () => client.insert(schema.coachOnboardingInvite).values(invites),
      catch: (cause) => new QueryFailed({ operation: "seedDemoWorkspaces.invites", cause }),
    })
  }
})

export * as DevSeed from "./dev-seed.ts"
