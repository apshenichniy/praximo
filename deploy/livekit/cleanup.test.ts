import { describe, expect, it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Ref } from "effect"

import { runCleanupPhases, withCleanup } from "./cleanup.ts"

describe("LiveKit maintenance cleanup", () => {
  it.effect("runs cleanup when the protected operation fails", () =>
    Effect.gen(function* () {
      let cleaned = false
      const error = yield* withCleanup(
        Effect.fail("operation failed"),
        Effect.sync(() => {
          cleaned = true
        }),
      ).pipe(Effect.flip)

      expect(error).toBe("operation failed")
      expect(cleaned).toBe(true)
    }),
  )

  it.effect("surfaces a cleanup failure after a successful operation", () =>
    Effect.gen(function* () {
      const error = yield* withCleanup(Effect.succeed("ok"), Effect.fail("cleanup failed")).pipe(
        Effect.flip,
      )

      expect(error).toBe("cleanup failed")
    }),
  )

  it.effect("runs cleanup when the protected operation is interrupted", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const cleaned = yield* Ref.make(false)
      const fiber = yield* withCleanup(
        Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never)),
        Ref.set(cleaned, true),
      ).pipe(Effect.forkChild)

      yield* Deferred.await(ready)
      yield* Fiber.interrupt(fiber)

      expect(yield* Ref.get(cleaned)).toBe(true)
    }),
  )

  it.effect("preserves both use and cleanup failures", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        withCleanup(Effect.fail("operation failed"), Effect.fail("cleanup failed")),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const rendered = Cause.pretty(exit.cause)
        expect(rendered).toContain("operation failed")
        expect(rendered).toContain("cleanup failed")
      }
    }),
  )

  it.effect("runs cleanup phases in order and continues after a failed phase", () =>
    Effect.gen(function* () {
      const order: string[] = []
      const exit = yield* Effect.exit(
        runCleanupPhases([
          Effect.sync(() => order.push("stop")),
          Effect.sync(() => order.push("wait")).pipe(Effect.andThen(Effect.fail("wait failed"))),
          Effect.sync(() => order.push("delete")),
        ]),
      )

      expect(order).toEqual(["stop", "wait", "delete"])
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
