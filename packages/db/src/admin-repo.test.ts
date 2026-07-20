import { describe, expect, it } from "@effect/vitest"
import { TelegramId } from "@praximo/domain"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { AdminRepo } from "./admin-repo.ts"
import { Database } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * The admin seam backing the db:reset seed. Skips when `DATABASE_URL` is absent
 * (see the workspace-repo test). The seed re-runs on every reset, so the seam's
 * contract is idempotency.
 */
const DATABASE_URL = process.env.DATABASE_URL

const uniqueTelegramId = (): TelegramId =>
  TelegramId.make(`tg_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`)

describe.skipIf(!DATABASE_URL)("AdminRepo (dev Neon branch)", () => {
  const appLayer = Layer.provideMerge(AdminRepo.layer, Database.testLayer(DATABASE_URL ?? ""))

  it.effect("upsertByTelegramId is idempotent — a re-seed converges to one row", () =>
    Effect.gen(function* () {
      const admins = yield* AdminRepo.Service
      const { client } = yield* Database.Service
      const telegramId = uniqueTelegramId()
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          client.delete(schema.admin).where(eq(schema.admin.telegramId, telegramId)),
        ),
      )

      const first = yield* admins.upsertByTelegramId(telegramId)
      const second = yield* admins.upsertByTelegramId(telegramId)

      expect(second.id).toBe(first.id)

      const rows = yield* Effect.promise(() =>
        client.select().from(schema.admin).where(eq(schema.admin.telegramId, telegramId)),
      )
      expect(rows.length).toBe(1)
    }).pipe(Effect.scoped, Effect.provide(appLayer)),
  )

  it.effect("findByTelegramId reports AdminNotFound for an unseeded id", () =>
    Effect.gen(function* () {
      const admins = yield* AdminRepo.Service
      const error = yield* Effect.flip(admins.findByTelegramId(uniqueTelegramId()))

      expect(error._tag).toBe("Domain.AdminNotFound")
    }).pipe(Effect.provide(appLayer)),
  )
})
