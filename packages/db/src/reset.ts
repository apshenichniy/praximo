import { readdir } from "node:fs/promises"
import path from "node:path"
import { TelegramId } from "@praximo/domain"
import { sql } from "drizzle-orm"
import { migrate } from "drizzle-orm/neon-http/migrator"
import { Effect, Layer } from "effect"
import { AdminRepo } from "./admin-repo.ts"
import { Database } from "./client.ts"
import { seedDemoWorkspaces } from "./dev-seed.ts"

/**
 * The dev-tooling half of db:reset (admin-surface.md §Dev tooling), kept as pure,
 * dependency-injected functions so the environment-free logic — above all the
 * prod guard — is unit-testable without a database or `process`. The Node runner
 * in `scripts/db-reset.ts` supplies the real env and does the logging.
 *
 * "Recreates/clears the branch" is done at schema granularity: dropping and
 * recreating `public` wipes every application table and Alchemy's bookkeeping.
 * The local Drizzle migrator keeps its ledger in a separate `drizzle` schema, so
 * that schema is reset as well. After replay, reset rebuilds Alchemy's
 * `neon_migrations` ledger from the same directory; otherwise the next deploy
 * would replay already-applied DDL. This needs only the connection URI — no Neon
 * control-plane call — so it never contends with Alchemy's ownership of the branch.
 */

/** Hardcoded stage guard (ADR 0003 stages `dev_<user>` / `prod`). */
export const assertNotProd = (stage: string): void => {
  if (stage === "prod") {
    throw new Error(`db:reset refuses to run against prod (resolved stage: ${stage})`)
  }
}

/** The stage is `APP_STAGE`, else the personal default `dev_<user>` (ADR 0003). */
export const resolveStage = (env: {
  readonly APP_STAGE?: string | undefined
  readonly USER?: string | undefined
}): string => {
  if (env.APP_STAGE) return env.APP_STAGE
  if (env.USER) return `dev_${env.USER}`
  throw new Error("cannot resolve stage: set APP_STAGE, or USER for the dev_<user> default")
}

/** Parse the root `.env` admin seed into validated Telegram identity keys. */
export const parseAdminTelegramIds = (value: string): ReadonlyArray<TelegramId> => {
  if (value.trim() === "") {
    throw new Error("ADMIN_TELEGRAM_IDS must contain at least one Telegram id")
  }

  return value.split(",").map((rawEntry, index) => {
    const entry = rawEntry.trim()
    const entryNumber = index + 1

    if (entry === "") {
      throw new Error(`ADMIN_TELEGRAM_IDS entry ${entryNumber} is empty`)
    }
    if (!/^[1-9]\d*$/.test(entry)) {
      throw new Error(
        `ADMIN_TELEGRAM_IDS entry ${entryNumber} ("${entry}") must be a positive decimal Telegram id`,
      )
    }

    return TelegramId.make(entry)
  })
}

/** `db:reset` accepts no arguments besides the explicit demo-fixture switch. */
export const parseResetArgs = (args: ReadonlyArray<string>): boolean => {
  if (args.length === 0) return false
  if (args.length === 1 && args[0] === "--demo") return true
  throw new Error(`unknown db:reset arguments: ${args.join(" ")}`)
}

export type ResetSeedStep = "admins" | "demo-workspaces"

/** The ordinary reset stays empty; demo fixtures are always an explicit step. */
export const makeResetSeedPlan = (demo: boolean): ReadonlyArray<ResetSeedStep> =>
  demo ? ["admins", "demo-workspaces"] : ["admins"]

const migrationPrefix = (name: string): number | undefined => {
  const parsed = Number.parseInt(name.split("_")[0] ?? "", 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Match Alchemy's recursive SQL-file ordering and ids so a local reset rebuilds
 * both migration ledgers. Otherwise the next deploy replays already-applied DDL.
 */
export const sortAlchemyMigrationNames = (names: ReadonlyArray<string>): ReadonlyArray<string> =>
  names
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.split(path.sep).join("/"))
    .sort((a, b) => {
      const aPrefix = migrationPrefix(a)
      const bPrefix = migrationPrefix(b)
      if (aPrefix !== undefined && bPrefix !== undefined) return aPrefix - bPrefix
      if (aPrefix !== undefined) return -1
      if (bPrefix !== undefined) return 1
      return a.localeCompare(b)
    })

const listAlchemyMigrationNames = async (
  migrationsFolder: string,
): Promise<ReadonlyArray<string>> =>
  sortAlchemyMigrationNames(await readdir(migrationsFolder, { recursive: true }))

const rebuildAlchemyMigrationLedger = async (
  client: ReturnType<typeof Database.makeClient>,
  migrationsFolder: string,
): Promise<void> => {
  const names = await listAlchemyMigrationNames(migrationsFolder)
  await client.execute(sql`
    create table if not exists "neon_migrations" (
      "id" text primary key,
      "name" text not null,
      "applied_at" timestamptz not null default now()
    )
  `)
  await Promise.all(
    names.map((name, index) =>
      client.execute(sql`
        insert into "neon_migrations" ("id", "name")
        values (${String(index + 1).padStart(5, "0")}, ${name})
      `),
    ),
  )
}

/** Seed every configured platform admin; repository upserts make duplicates idempotent. */
export const seedAdmins = Effect.fn("Reset.seedAdmins")(function* (
  telegramIds: ReadonlyArray<TelegramId>,
) {
  const admins = yield* AdminRepo.Service
  yield* Effect.forEach(telegramIds, (telegramId) => admins.upsertByTelegramId(telegramId), {
    discard: true,
  })
})

export interface ResetConfig {
  readonly stage: string
  readonly databaseUrl: string
  /** The raw comma-separated admin Telegram ids from `.env`. */
  readonly adminTelegramIds: string
  readonly migrationsFolder: string
  readonly demo?: boolean
}

/**
 * Clear the dev branch to bare schema, run migrations, seed the admin. Re-checks
 * the stage guard itself — the destructive `DROP SCHEMA` must never depend on a
 * caller having guarded first.
 */
export const runReset = async (config: ResetConfig): Promise<void> => {
  assertNotProd(config.stage)
  // Reject malformed seed input before the destructive schema reset begins.
  const adminTelegramIds = parseAdminTelegramIds(config.adminTelegramIds)

  const client = Database.makeClient(config.databaseUrl)

  await client.execute(sql`drop schema if exists drizzle cascade`)
  await client.execute(sql`drop schema if exists public cascade`)
  await client.execute(sql`create schema public`)

  await migrate(client, { migrationsFolder: config.migrationsFolder })
  await rebuildAlchemyMigrationLedger(client, config.migrationsFolder)

  const seedPlan = makeResetSeedPlan(config.demo === true)
  await Effect.runPromise(
    Effect.gen(function* () {
      for (const step of seedPlan) {
        if (step === "admins") {
          yield* seedAdmins(adminTelegramIds)
        } else {
          yield* seedDemoWorkspaces()
        }
      }
    }).pipe(
      Effect.provide(AdminRepo.layer),
      // Reuse the one client already built for the DDL, rather than opening a second.
      Effect.provide(Layer.succeed(Database.Service, Database.Service.of({ client }))),
    ),
  )
}

export * as Reset from "./reset.ts"
