import { Cause, Effect, Exit } from "effect"

export const releaseWithExit = <A, E, E2, R>(
  exit: Exit.Exit<A, E>,
  cleanup: Effect.Effect<unknown, E2, R>,
): Effect.Effect<void, E | E2, R> =>
  cleanup.pipe(
    Effect.matchCauseEffect({
      onFailure: (cleanupCause) =>
        Effect.failCause(
          Exit.isFailure(exit) ? Cause.combine(exit.cause, cleanupCause) : cleanupCause,
        ),
      onSuccess: () => Effect.void,
    }),
  )

export const withCleanup = <A, E, R, B, E2, R2>(
  use: Effect.Effect<A, E, R>,
  cleanup: Effect.Effect<B, E2, R2>,
): Effect.Effect<A, E | E2, R | R2> =>
  Effect.acquireUseRelease(
    Effect.void,
    () => use,
    (_, exit) => releaseWithExit(exit, cleanup),
  )

export const runCleanupPhases = <E, R>(
  phases: ReadonlyArray<Effect.Effect<unknown, E, R>>,
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    let combinedCause: Cause.Cause<E> | undefined
    for (const phase of phases) {
      const exit = yield* Effect.exit(phase)
      if (Exit.isFailure(exit)) {
        combinedCause =
          combinedCause === undefined ? exit.cause : Cause.combine(combinedCause, exit.cause)
      }
    }
    if (combinedCause !== undefined) {
      return yield* Effect.failCause(combinedCause)
    }
  })
