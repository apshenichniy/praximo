import { Admin, AdminNotFound, TelegramId } from "@praximo/domain"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database, decodeFirstRow, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

/**
 * The platform-admin seam. It backs the db:reset admin seed and proves the
 * "new repositories follow the same module-namespace style" contract of slice
 * #36 alongside the reference {@link WorkspaceRepo}.
 *
 * `upsertByTelegramId` is idempotent — the seed re-runs on every reset, so it
 * must converge to a single row per Telegram id.
 */
export interface Interface {
  readonly upsertByTelegramId: (telegramId: TelegramId) => Effect.Effect<Admin, QueryFailed>
  readonly findByTelegramId: (
    telegramId: TelegramId,
  ) => Effect.Effect<Admin, AdminNotFound | QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/AdminRepo") {}

const decodeAdmin = Schema.decodeUnknownEffect(Admin)

/** Deterministic id from the (unique) Telegram id — no randomness, idempotent. */
const adminId = (telegramId: TelegramId): string => `adm_${telegramId}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    const upsertByTelegramId = Effect.fn("AdminRepo.upsertByTelegramId")(function* (
      telegramId: TelegramId,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .insert(schema.admin)
            .values({ id: adminId(telegramId), telegramId })
            // Idempotent: a second seed for the same id is a no-op update, and we
            // still read back the existing row's id via RETURNING.
            .onConflictDoUpdate({ target: schema.admin.telegramId, set: { telegramId } })
            .returning({ id: schema.admin.id, telegramId: schema.admin.telegramId }),
        catch: (cause) => new QueryFailed({ operation: "upsertByTelegramId", cause }),
      })

      return yield* decodeFirstRow(rows, "upsertByTelegramId", decodeAdmin, () =>
        Effect.fail(
          new QueryFailed({
            operation: "upsertByTelegramId",
            cause: new Error("upsert returned no row"),
          }),
        ),
      )
    })

    const findByTelegramId = Effect.fn("AdminRepo.findByTelegramId")(function* (
      telegramId: TelegramId,
    ) {
      const rows = yield* Effect.tryPromise({
        try: () =>
          client
            .select({ id: schema.admin.id, telegramId: schema.admin.telegramId })
            .from(schema.admin)
            .where(eq(schema.admin.telegramId, telegramId))
            .limit(1),
        catch: (cause) => new QueryFailed({ operation: "findByTelegramId", cause }),
      })

      return yield* decodeFirstRow(rows, "findByTelegramId", decodeAdmin, () =>
        Effect.fail(new AdminNotFound({ telegramId })),
      )
    })

    return Service.of({ upsertByTelegramId, findByTelegramId })
  }),
)

export * as AdminRepo from "./admin-repo.ts"
