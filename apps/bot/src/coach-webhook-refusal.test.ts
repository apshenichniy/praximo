import { describe, expect, it } from "@effect/vitest"
import { CoachBotProvisioningRepo, QueryFailed } from "@praximo/db"
import { Effect, Layer } from "effect"
import { refusalFor, refusalStatus, UndecidedRefusalStatus } from "./coach-webhook-refusal.ts"

/**
 * What a coach bot's own route does with an update neither the installation nor
 * the ownership handshake could serve (#150).
 *
 * Since arming the webhook moved after the activation transaction, `redeliver`
 * is the tripwire branch: reaching it means an update got to a bot whose
 * installation does not exist yet, which the new order is supposed to make
 * impossible. Both branches log, because the incident behind this module had to
 * be reconstructed from database timestamps.
 */

const BOT_ID = "9100010"
const ATTEMPT = {
  id: "cbp_test_800000101",
  updatedAt: new Date("2026-07-25T17:02:25.384Z"),
}

const unsupported = () => Effect.die(new Error("unsupported test operation"))

const repoStub = (
  inFlight: Effect.Effect<CoachBotProvisioningRepo.InFlightAttempt | undefined, QueryFailed>,
): Layer.Layer<CoachBotProvisioningRepo.Service> =>
  Layer.succeed(
    CoachBotProvisioningRepo.Service,
    CoachBotProvisioningRepo.Service.of({
      prepare: unsupported,
      claim: unsupported,
      recordPrompt: unsupported,
      ingestCandidate: unsupported,
      findCandidateByBotId: unsupported,
      complete: unsupported,
      reopenForRelink: unsupported,
      findByBotId: unsupported,
      findInFlightManagedAttempt: () => inFlight,
      findByWorkspace: unsupported,
      workspaceProfile: unsupported,
      rotate: unsupported,
      pendingNotifications: unsupported,
      markNotificationDelivered: unsupported,
      deferNotification: unsupported,
    }),
  )

describe("refusing an update on an uninstalled coach bot's route", () => {
  it.effect("names the attempt when one still holds the bot, and asks for a repeat", () =>
    Effect.gen(function* () {
      const refusal = yield* refusalFor(BOT_ID).pipe(
        Effect.provide(repoStub(Effect.succeed(ATTEMPT))),
      )

      // The attempt id travels with the decision so the log can name it — that is
      // the whole reason this returns a shape rather than a status.
      expect(refusal).toEqual({ _tag: "redeliver", attemptId: ATTEMPT.id })
      expect(refusalStatus(refusal)).toBe(500)
    }),
  )

  it.effect("refuses outright when nothing here explains the update", () =>
    Effect.gen(function* () {
      const refusal = yield* refusalFor(BOT_ID).pipe(
        Effect.provide(repoStub(Effect.succeed(undefined))),
      )

      // An unknown bot, or a caller who could not authenticate against a parked
      // candidate: no retry could help, and the answer discloses nothing.
      expect(refusal).toEqual({ _tag: "refuse" })
      expect(refusalStatus(refusal)).toBe(401)
    }),
  )

  it.effect("leaves the decision to the caller when the attempt cannot be read", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        refusalFor(BOT_ID).pipe(
          Effect.provide(
            repoStub(
              Effect.fail(
                new QueryFailed({
                  operation: "provisioning.findInFlightManagedAttempt",
                  cause: new Error("connection refused"),
                }),
              ),
            ),
          ),
        ),
      )

      expect(failure).toMatchObject({ _tag: "Database.QueryFailed" })
      // And what the caller falls back to is a repeat, not a refusal: "we do not
      // know yet" is not something to turn a coach's first message away over.
      expect(UndecidedRefusalStatus).toBe(500)
    }),
  )
})
