import { ObjectCleanupRepo, QueryFailed } from "@praximo/db"
import { Clock, Context, Effect, Layer } from "effect"

export interface Bucket {
  readonly delete: (key: string) => Promise<unknown>
}

export interface Interface {
  readonly runOnce: () => Effect.Effect<void, QueryFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/pipeline/ObjectCleanup",
) {}

export const layer = (bucket: Bucket) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const jobs = yield* ObjectCleanupRepo.Service

      const runOnce = Effect.fn("ObjectCleanup.runOnce")(function* () {
        const now = new Date(yield* Clock.currentTimeMillis)
        const claimed = yield* jobs.claimBatch(now, 50)

        for (const job of claimed) {
          const deleted = yield* Effect.tryPromise({
            try: () => bucket.delete(job.objectKey),
            catch: () => undefined,
          }).pipe(
            Effect.match({
              onFailure: () => false,
              onSuccess: () => true,
            }),
          )

          if (deleted) {
            yield* jobs.complete(job.id)
          } else {
            yield* jobs.fail(job.id, new Date(yield* Clock.currentTimeMillis), "r2-delete-failed")
          }
        }
      })

      return Service.of({ runOnce })
    }),
  )

export * as ObjectCleanup from "./object-cleanup.ts"
