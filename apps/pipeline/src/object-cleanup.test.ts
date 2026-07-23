import { describe, expect, it } from "@effect/vitest"
import { ObjectCleanupRepo } from "@praximo/db"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ObjectCleanup } from "./object-cleanup.ts"

describe("ObjectCleanup", () => {
  it.effect("completes deleted objects and reschedules opaque failures", () => {
    const completed: Array<string> = []
    const failed: Array<{ readonly id: string; readonly reason: string }> = []
    const repoLayer = Layer.succeed(
      ObjectCleanupRepo.Service,
      ObjectCleanupRepo.Service.of({
        claimBatch: Effect.fn("ObjectCleanupRepo.Test.claimBatch")(() =>
          Effect.succeed([
            { id: "job_ok", objectKey: "uploads/ok.jpg", attempts: 0 },
            { id: "job_retry", objectKey: "uploads/retry.jpg", attempts: 1 },
          ]),
        ),
        complete: Effect.fn("ObjectCleanupRepo.Test.complete")((id) =>
          Effect.sync(() => {
            completed.push(id)
          }),
        ),
        fail: Effect.fn("ObjectCleanupRepo.Test.fail")((id, _now, reason) =>
          Effect.sync(() => {
            failed.push({ id, reason })
          }),
        ),
      }),
    )
    const layer = Layer.provideMerge(
      ObjectCleanup.layer({
        delete: (key) =>
          key.endsWith("retry.jpg")
            ? Promise.reject(new Error("secret provider response"))
            : Promise.resolve(),
      }),
      repoLayer,
    )

    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-23T12:00:00.000Z"))
      const cleanup = yield* ObjectCleanup.Service
      yield* cleanup.runOnce()

      expect(completed).toEqual(["job_ok"])
      expect(failed).toEqual([{ id: "job_retry", reason: "r2-delete-failed" }])
    }).pipe(Effect.provide(layer))
  })
})
