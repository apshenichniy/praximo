import type { CoachLanguage } from "@praximo/domain"
import { and, eq, like } from "drizzle-orm"
import { Effect } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * Every row this seed writes carries this prefix on its primary key.
 *
 * The whole of `--clear` rests on it: a delete scoped to `workspace_id` *and*
 * this prefix cannot mistake a real client for a seeded one, and it needs no
 * schema change to say which is which. The `_` is escaped wherever it reaches a
 * `LIKE`, since Postgres reads a bare underscore as a wildcard.
 */
export const DemoIdPrefix = "demo_"

const DemoIdPattern = "demo\\_%"

export interface DemoSession {
  readonly id: string
  /** Negative for a session that has already happened. */
  readonly startsInMinutes: number
  readonly durationMinutes: number
  readonly kind: "intake" | "regular"
  readonly state: "scheduled" | "completed" | "cancelled"
}

export interface DemoClientInvite {
  readonly id: string
  readonly token: string
  readonly status: "pending" | "accepted" | "expired"
  /** Negative for an invitation whose seven-day window has already closed. */
  readonly expiresInHours: number
  readonly delivery: { readonly kind: "telegram" | "email" | "link"; readonly address?: string }
}

export interface DemoClient {
  readonly id: string
  /**
   * A human name, in the alphabet a real client of this coach would have. Half
   * the decisions about truncation and line wrapping are only visible on real
   * names in three scripts — "Client 3" hides every one of them.
   */
  readonly name: string
  readonly language: CoachLanguage | undefined
  /** Present once the client has accepted: an accepted invite is a channel. */
  readonly channel?: { readonly kind: "telegram" | "email"; readonly address: string }
  readonly invite?: DemoClientInvite
  readonly sessions: ReadonlyArray<DemoSession>
}

const Hour = 60
const Day = 24 * Hour

/**
 * The states of #56's client list and #61's needs-attention section, as data.
 *
 * **These cannot be produced by hand.** "Invitation expires tomorrow" needs a
 * six-day wait, "expired" needs eight, and "session in 40 minutes" needs sitting
 * at the screen at the right moment. Every offset below is relative to the run,
 * so a fixture is as truthful an hour after seeding as it is a fortnight later.
 */
export const demoClients: ReadonlyArray<DemoClient> = [
  {
    // The needs-attention headline: a session close enough to be the next thing
    // that happens today.
    id: "demo_client_maria",
    name: "Maria K.",
    language: "en",
    channel: { kind: "telegram", address: "810000001" },
    sessions: [
      {
        id: "demo_session_maria_next",
        startsInMinutes: 40,
        durationMinutes: 60,
        kind: "regular",
        state: "scheduled",
      },
      {
        id: "demo_session_maria_past",
        startsInMinutes: -7 * Day,
        durationMinutes: 60,
        kind: "intake",
        state: "completed",
      },
    ],
  },
  {
    // An established client: enough history for the list to have to summarise it,
    // and sessions on three different days so grouping by day is exercised.
    id: "demo_client_dmytro",
    name: "Дмитро Т.",
    language: "uk",
    channel: { kind: "telegram", address: "810000002" },
    sessions: [
      {
        id: "demo_session_dmytro_past",
        startsInMinutes: -9 * Day,
        durationMinutes: 90,
        kind: "intake",
        state: "completed",
      },
      {
        id: "demo_session_dmytro_soon",
        startsInMinutes: 2 * Day + 3 * Hour,
        durationMinutes: 60,
        kind: "regular",
        state: "scheduled",
      },
      {
        id: "demo_session_dmytro_later",
        startsInMinutes: 9 * Day + 5 * Hour,
        durationMinutes: 60,
        kind: "regular",
        state: "scheduled",
      },
    ],
  },
  {
    // An invitation inside its last two days — the countdown that reads
    // "expires in 2d" and then, without anybody touching it, "expires today".
    id: "demo_client_olena",
    name: "Олена П.",
    language: "uk",
    invite: {
      id: "demo_invite_olena",
      token: "demo_tok_olena_pending",
      status: "pending",
      expiresInHours: 2 * 24,
      delivery: { kind: "telegram" },
    },
    sessions: [],
  },
  {
    // The invitation that lapsed. Distinct from "never invited": the coach did
    // the work and the client did not answer, which is a different row and a
    // different action.
    id: "demo_client_artem",
    name: "Артём В.",
    language: "ru",
    invite: {
      id: "demo_invite_artem",
      token: "demo_tok_artem_expired",
      status: "expired",
      expiresInHours: -3 * 24,
      delivery: { kind: "email", address: "artem.demo@example.com" },
    },
    sessions: [],
  },
  {
    // Both at once: a session already on the books for somebody who has not
    // accepted yet. The row has to say two things without contradicting itself.
    id: "demo_client_sofia",
    name: "Sofia R.",
    language: "en",
    invite: {
      id: "demo_invite_sofia",
      token: "demo_tok_sofia_pending",
      status: "pending",
      expiresInHours: 5 * 24,
      delivery: { kind: "email", address: "sofia.demo@example.com" },
    },
    sessions: [
      {
        // Today, and undeliverable: this is the card #61 spends its amber on —
        // the state word plus its consequence plus the action that fixes it.
        //
        // **Two of them, one ahead and one behind**, because Today shows the
        // coach's *day* and every offset rolls over it eventually: seeded at
        // 22:00 a `+2h` session lands on tomorrow, seeded at 00:30 a `-1h` one
        // landed yesterday. Between the pair at least one is always on today's
        // calendar, which is what the acceptance criterion actually asks for.
        // A `scheduled` session an hour into the past is honest until #42:
        // nothing transitions it, because nothing can yet.
        id: "demo_session_sofia_today",
        startsInMinutes: 2 * Hour,
        durationMinutes: 60,
        kind: "regular",
        state: "scheduled",
      },
      {
        id: "demo_session_sofia_started",
        startsInMinutes: -1 * Hour,
        durationMinutes: 60,
        kind: "regular",
        state: "scheduled",
      },
      {
        id: "demo_session_sofia_first",
        startsInMinutes: 4 * Day + 2 * Hour,
        durationMinutes: 90,
        kind: "intake",
        state: "scheduled",
      },
    ],
  },
  {
    // Accepted, connected, and nothing scheduled. The empty state that belongs
    // to a real client rather than to an empty practice.
    id: "demo_client_ivan",
    name: "Ivan L.",
    language: "en",
    channel: { kind: "telegram", address: "810000006" },
    sessions: [],
  },
]

/** The consent text version a seeded client agreed to; shape only, never read. */
const DemoConsentVersion = "2026-08-01+devdemo"

const at = (now: Date, minutesFromNow: number): Date =>
  new Date(now.getTime() + minutesFromNow * 60_000)

const inHours = (now: Date, hours: number): Date => new Date(now.getTime() + hours * 3_600_000)

export interface DemoArgs {
  /** Remove what a previous run wrote, and seed nothing. */
  readonly clear: boolean
  /** A bot username (with or without `@`) or a Telegram bot id. */
  readonly bot: string | undefined
}

/**
 * `db:demo` takes a target and a mode, and refuses anything else — a typo in a
 * flag must not silently seed the wrong thing or, worse, silently seed nothing.
 */
export const parseDemoArgs = (args: ReadonlyArray<string>): DemoArgs => {
  let clear = false
  let bot: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--clear") {
      clear = true
      continue
    }
    if (argument === "--bot") {
      const value = args[index + 1]
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--bot needs a value: a bot username or its Telegram bot id")
      }
      bot = value
      index += 1
      continue
    }
    throw new Error(`unknown db:demo argument: ${argument ?? ""}`)
  }

  return { clear, bot }
}

/** A connected workspace `db:demo` can seed into. */
export interface DemoTarget {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly botUsername: string | null
  readonly telegramBotId: string | null
}

export class DemoTargetUnresolved extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DemoTargetUnresolved"
  }
}

/**
 * Which workspace the fixtures go into.
 *
 * A single connected workspace needs no argument — that is the ordinary case, one
 * developer with one bot. More than one has to be named, because seeding the
 * wrong practice is invisible until somebody opens the wrong Mini App. Pure, so
 * the rule is testable without a database.
 */
export const resolveDemoTarget = (
  candidates: ReadonlyArray<DemoTarget>,
  selector: string | undefined,
): DemoTarget => {
  if (candidates.length === 0) {
    throw new DemoTargetUnresolved(
      "no connected workspace to seed into — finish a coach bot setup first, or run `bun db:reset --demo` for the admin fixtures",
    )
  }

  if (selector !== undefined) {
    const wanted = selector.replace(/^@/, "")
    const matched = candidates.filter(
      (candidate) => candidate.botUsername === wanted || candidate.telegramBotId === wanted,
    )
    if (matched.length === 0) {
      throw new DemoTargetUnresolved(
        `no connected workspace for --bot ${selector}. Available: ${describe(candidates)}`,
      )
    }
    // A username is unique in Telegram and `telegram_bot_id` is unique in the
    // schema, so this cannot legitimately match twice.
    return matched[0] as DemoTarget
  }

  if (candidates.length > 1) {
    throw new DemoTargetUnresolved(
      `more than one connected workspace — choose with --bot <username|id>. Available: ${describe(candidates)}`,
    )
  }

  return candidates[0] as DemoTarget
}

const describe = (candidates: ReadonlyArray<DemoTarget>): string =>
  candidates
    .map(
      (candidate) =>
        `${candidate.botUsername ?? candidate.telegramBotId ?? "?"} (${candidate.workspaceName})`,
    )
    .join(", ")

/** Every connected workspace, as a target. */
export const connectedWorkspaces = Effect.fn("DemoClients.connectedWorkspaces")(function* () {
  const { client } = yield* Database.Service

  const rows = yield* Effect.tryPromise({
    try: () =>
      client
        .select({
          workspaceId: schema.bot.workspaceId,
          workspaceName: schema.workspace.name,
          botUsername: schema.bot.username,
          telegramBotId: schema.bot.telegramBotId,
        })
        .from(schema.bot)
        .innerJoin(schema.workspace, eq(schema.workspace.id, schema.bot.workspaceId))
        .where(eq(schema.bot.connectionStatus, "connected")),
    catch: (cause) => new QueryFailed({ operation: "demoClients.connectedWorkspaces", cause }),
  })

  return rows satisfies ReadonlyArray<DemoTarget>
})

/**
 * Remove exactly what a previous `db:demo` wrote into this workspace.
 *
 * Deleting the clients is enough for everything hanging off them — channels,
 * invites, consent grants and sessions all cascade on `client_id` — but sessions
 * are deleted explicitly first anyway, prefix-scoped, so a session seeded against
 * a client that has since been removed by hand cannot survive as an orphan.
 */
export const clearDemoClients = Effect.fn("DemoClients.clearDemoClients")(function* (
  workspaceId: string,
) {
  const { client } = yield* Database.Service

  const remove = (
    table: Parameters<typeof client.delete>[0],
    where: Parameters<ReturnType<typeof client.delete>["where"]>[0],
    operation: string,
  ) =>
    Effect.tryPromise({
      try: () => client.delete(table).where(where),
      catch: (cause) => new QueryFailed({ operation, cause }),
    })

  yield* remove(
    schema.session,
    and(eq(schema.session.workspaceId, workspaceId), like(schema.session.id, DemoIdPattern)),
    "clearDemoClients.sessions",
  )
  yield* remove(
    schema.client,
    and(eq(schema.client.workspaceId, workspaceId), like(schema.client.id, DemoIdPattern)),
    "clearDemoClients.clients",
  )
})

/**
 * Seed the client and session fixtures into an existing workspace.
 *
 * Never touches the workspace, its bot, or its members — unlike `db:reset`, which
 * drops the schema and takes the coach's bot connection with it. That separation
 * is the point of a second command: a UI iteration must not end in re-provisioning
 * a bot through @BotFather, and "a brand-new coach with an empty practice" has to
 * stay reachable.
 *
 * Idempotent by way of `clearDemoClients`, so a re-run refreshes the relative
 * times rather than colliding on a primary key.
 */
export const seedDemoClients = Effect.fn("DemoClients.seedDemoClients")(function* (
  now: Date,
  workspaceId: string,
) {
  const { client } = yield* Database.Service

  yield* clearDemoClients(workspaceId)

  const insertAll = <Row>(
    table: Parameters<typeof client.insert>[0],
    rows: ReadonlyArray<Row>,
    operation: string,
  ) =>
    rows.length === 0
      ? Effect.void
      : Effect.tryPromise({
          try: () => client.insert(table).values(rows as never),
          catch: (cause) => new QueryFailed({ operation, cause }),
        })

  yield* insertAll(
    schema.client,
    demoClients.map((demo) => ({
      id: demo.id,
      workspaceId,
      name: demo.name,
      language: demo.language ?? null,
    })),
    "seedDemoClients.clients",
  )

  yield* insertAll(
    schema.channel,
    demoClients.flatMap((demo) =>
      demo.channel === undefined
        ? []
        : [
            {
              id: `${demo.id}_channel`,
              clientId: demo.id,
              kind: demo.channel.kind,
              address: demo.channel.address,
              isPrimary: true,
            },
          ],
    ),
    "seedDemoClients.channels",
  )

  yield* insertAll(
    schema.invite,
    demoClients.flatMap((demo) =>
      demo.invite === undefined
        ? []
        : [
            {
              id: demo.invite.id,
              workspaceId,
              clientId: demo.id,
              token: demo.invite.token,
              status: demo.invite.status,
              delivery: demo.invite.delivery,
              expiresAt: inHours(now, demo.invite.expiresInHours),
            },
          ],
    ),
    "seedDemoClients.invites",
  )

  // Consent belongs to a client who accepted, which is exactly the ones that
  // have a channel. A pending invitation has granted nothing yet.
  yield* insertAll(
    schema.consentGrant,
    demoClients.flatMap((demo) =>
      demo.channel === undefined
        ? []
        : [
            {
              id: `${demo.id}_consent`,
              clientId: demo.id,
              textVersion: DemoConsentVersion,
              channelKind: demo.channel.kind,
            },
          ],
    ),
    "seedDemoClients.consentGrants",
  )

  yield* insertAll(
    schema.session,
    demoClients.flatMap((demo) =>
      demo.sessions.map((session) => ({
        id: session.id,
        workspaceId,
        clientId: demo.id,
        scheduledAt: at(now, session.startsInMinutes),
        durationMinutes: session.durationMinutes,
        kind: session.kind,
        state: session.state,
        startedAt: session.state === "completed" ? at(now, session.startsInMinutes) : null,
      })),
    ),
    "seedDemoClients.sessions",
  )
})

/** How many rows of each kind a seeded workspace now holds — the runner's log line. */
export const demoSeedSummary = {
  clients: demoClients.length,
  invites: demoClients.filter((demo) => demo.invite !== undefined).length,
  sessions: demoClients.reduce((total, demo) => total + demo.sessions.length, 0),
} as const

export * as DemoClients from "./demo-clients.ts"
