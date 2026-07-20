import { defineConfig } from "drizzle-kit"

/**
 * Drizzle Kit config for the one migrations dir both consumers share: Alchemy
 * auto-applies it at deploy (`migrationsDir` on the Neon branch, ADR 0003) and
 * db:reset replays the same files via the neon-http migrator. `generate` needs
 * no live connection; migrations are applied by those two, never by `push`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
})
