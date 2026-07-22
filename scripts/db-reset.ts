import { fileURLToPath } from "node:url"
import { assertNotProd, resolveStage, runReset } from "../packages/db/src/reset.ts"

/**
 * `bun run db:reset` — recreate the dev Neon branch, run migrations, and seed the
 * admins from the root `.env` (admin-surface.md §Dev tooling). Refuses to run
 * against `prod` (ADR 0003). The safety-critical logic lives in `@praximo/db`'s
 * pure `reset.ts`; this runner only supplies the environment and logs.
 */

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`missing ${name} — set it in the root .env (see .env.example)`)
  }
  return value
}

const stage = resolveStage({ APP_STAGE: process.env.APP_STAGE, USER: process.env.USER })
assertNotProd(stage)

const migrationsFolder = fileURLToPath(new URL("../packages/db/migrations", import.meta.url))

console.log(`db:reset — clearing and re-seeding stage ${stage}`)

await runReset({
  stage,
  databaseUrl: requireEnv("DATABASE_URL"),
  adminTelegramIds: requireEnv("ADMIN_TELEGRAM_IDS"),
  migrationsFolder,
})

console.log(`db:reset — done (stage ${stage}): schema rebuilt, admins seeded`)
