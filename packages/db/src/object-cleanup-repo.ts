import { eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database, QueryFailed } from "./client.ts"
import * as schema from "./schema.ts"

export const Job = Schema.Struct({
  id: Schema.NonEmptyString,
  objectKey: Schema.NonEmptyString,
  attempts: Schema.Number,
})
export interface Job extends Schema.Schema.Type<typeof Job> {}

export interface Interface {
  readonly claimBatch: (now: Date, limit: number) => Effect.Effect<ReadonlyArray<Job>, QueryFailed>
  readonly complete: (id: string) => Effect.Effect<void, QueryFailed>
  readonly fail: (id: string, now: Date, reason: string) => Effect.Effect<void, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/db/ObjectCleanupRepo",
) {}

const decodeJobs = Schema.decodeUnknownEffect(Schema.Array(Job))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { client } = yield* Database.Service

    const claimBatch: Interface["claimBatch"] = Effect.fn("ObjectCleanupRepo.claimBatch")(
      function* (now, limit) {
        const leaseUntil = new Date(now.getTime() + 5 * 60 * 1_000)
        const rows = yield* Effect.tryPromise({
          try: () =>
            client
              .update(schema.objectCleanupJob)
              .set({ status: "leased", leaseUntil, updatedAt: now })
              .where(
                sql`${schema.objectCleanupJob.id} in (
                  select ${schema.objectCleanupJob.id}
                  from ${schema.objectCleanupJob}
                  where
                    ${schema.objectCleanupJob.availableAt} <= ${now}
                    and (
                      ${schema.objectCleanupJob.status} = 'pending'
                      or (
                        ${schema.objectCleanupJob.status} = 'leased'
                        and ${schema.objectCleanupJob.leaseUntil} <= ${now}
                      )
                    )
                  order by ${schema.objectCleanupJob.createdAt}
                  limit ${limit}
                  for update skip locked
                )`,
              )
              .returning({
                id: schema.objectCleanupJob.id,
                objectKey: schema.objectCleanupJob.objectKey,
                attempts: schema.objectCleanupJob.attempts,
              }),
          catch: (cause) => new QueryFailed({ operation: "ObjectCleanupRepo.claimBatch", cause }),
        })
        return yield* decodeJobs(rows).pipe(
          Effect.mapError(
            (cause) => new QueryFailed({ operation: "ObjectCleanupRepo.claimBatch.decode", cause }),
          ),
        )
      },
    )

    const complete: Interface["complete"] = Effect.fn("ObjectCleanupRepo.complete")(function* (id) {
      yield* Effect.tryPromise({
        try: () => client.delete(schema.objectCleanupJob).where(eq(schema.objectCleanupJob.id, id)),
        catch: (cause) => new QueryFailed({ operation: "ObjectCleanupRepo.complete", cause }),
      })
    })

    const fail: Interface["fail"] = Effect.fn("ObjectCleanupRepo.fail")(
      function* (id, now, reason) {
        const current = yield* Effect.tryPromise({
          try: () =>
            client
              .select({ attempts: schema.objectCleanupJob.attempts })
              .from(schema.objectCleanupJob)
              .where(eq(schema.objectCleanupJob.id, id))
              .limit(1),
          catch: (cause) => new QueryFailed({ operation: "ObjectCleanupRepo.fail.load", cause }),
        })
        const attempts = (current[0]?.attempts ?? 0) + 1
        const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6))
        yield* Effect.tryPromise({
          try: () =>
            client
              .update(schema.objectCleanupJob)
              .set({
                status: "pending",
                attempts,
                availableAt: new Date(now.getTime() + delayMinutes * 60 * 1_000),
                leaseUntil: null,
                lastError: reason,
                updatedAt: now,
              })
              .where(eq(schema.objectCleanupJob.id, id)),
          catch: (cause) => new QueryFailed({ operation: "ObjectCleanupRepo.fail", cause }),
        })
      },
    )

    return Service.of({ claimBatch, complete, fail })
  }),
)

export * as ObjectCleanupRepo from "./object-cleanup-repo.ts"
