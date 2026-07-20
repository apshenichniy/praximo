import { TelegramId } from "@praximo/domain"
import { sql } from "drizzle-orm"
import { migrate } from "drizzle-orm/neon-http/migrator"
import { Effect, Layer } from "effect"
import { AdminRepo } from "./admin-repo.ts"
import { Database } from "./client.ts"

/**
 * The dev-tooling half of db:reset (admin-surface.md §Dev tooling), kept as pure,
 * dependency-injected functions so the environment-free logic — above all the
 * prod guard — is unit-testable without a database or `process`. The Node runner
 * in `scripts/db-reset.ts` supplies the real env and does the logging.
 *
 * "Recreates/clears the branch" is done at schema granularity: dropping and
 * recreating `public` wipes every table and the migration bookkeeping, so the
 * subsequent migrate rebuilds from zero. This needs only the connection URI — no
 * Neon control-plane call — so it never contends with Alchemy's ownership of the
 * branch. (Alchemy tracks its deploy-time migrations in `neon_migrations`; the
 * migrator here uses its own `__drizzle_migrations` table. They don't collide.)
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

export interface ResetConfig {
  readonly stage: string
  readonly databaseUrl: string
  /** The raw admin Telegram id from `.env`; branded at the seed boundary below. */
  readonly adminTelegramId: string
  readonly migrationsFolder: string
}

/**
 * Clear the dev branch to bare schema, run migrations, seed the admin. Re-checks
 * the stage guard itself — the destructive `DROP SCHEMA` must never depend on a
 * caller having guarded first.
 */
export const runReset = async (config: ResetConfig): Promise<void> => {
  assertNotProd(config.stage)

  const client = Database.makeClient(config.databaseUrl)

  await client.execute(sql`drop schema if exists public cascade`)
  await client.execute(sql`create schema public`)

  await migrate(client, { migrationsFolder: config.migrationsFolder })

  await Effect.runPromise(
    Effect.gen(function* () {
      const admins = yield* AdminRepo.Service
      yield* admins.upsertByTelegramId(TelegramId.make(config.adminTelegramId))
    }).pipe(
      Effect.provide(AdminRepo.layer),
      // Reuse the one client already built for the DDL, rather than opening a second.
      Effect.provide(Layer.succeed(Database.Service, Database.Service.of({ client }))),
    ),
  )
}

export * as Reset from "./reset.ts"
