import { describe, expect, it } from "@effect/vitest"
import { CoachBotProvisioningRepo } from "@praximo/db"
import { TelegramId, WorkspaceId } from "@praximo/domain"
import { ManagerBotSender } from "@praximo/telegram"
import { Effect, Layer, Ref } from "effect"
import { deliverCoachNotifications } from "./provisioning.ts"

const unsupported = () => Effect.die(new Error("unsupported test operation"))

const issuer = TelegramId.make("100000001")

const notification = (
  kind: string,
  overrides: Partial<CoachBotProvisioningRepo.PendingNotification> = {},
): CoachBotProvisioningRepo.PendingNotification => ({
  id: `cbn_ada_${kind}`,
  workspaceId: WorkspaceId.make("ws_ada"),
  kind,
  recipientTelegramId: issuer,
  workspaceName: "Ada Coaching",
  botUsername: "ada_coach_bot",
  attemptCount: 0,
  ...overrides,
})

interface Marks {
  readonly delivered: Ref.Ref<ReadonlyArray<string>>
  readonly deferred: Ref.Ref<ReadonlyArray<string>>
}

const run = (queued: ReadonlyArray<CoachBotProvisioningRepo.PendingNotification>) =>
  Effect.gen(function* () {
    const marks: Marks = {
      delivered: yield* Ref.make<ReadonlyArray<string>>([]),
      deferred: yield* Ref.make<ReadonlyArray<string>>([]),
    }
    const repo = Layer.succeed(
      CoachBotProvisioningRepo.Service,
      CoachBotProvisioningRepo.Service.of({
        prepare: unsupported,
        claim: unsupported,
        recordPrompt: unsupported,
        ingestCandidate: unsupported,
        findCandidateByBotId: unsupported,
        complete: unsupported,
        findByBotId: unsupported,
        findByWorkspace: unsupported,
        workspaceProfile: unsupported,
        rotate: unsupported,
        pendingNotifications: () => Effect.succeed(queued),
        markNotificationDelivered: (id) =>
          Ref.update(marks.delivered, (ids) => [...ids, id]).pipe(Effect.asVoid),
        deferNotification: (id) =>
          Ref.update(marks.deferred, (ids) => [...ids, id]).pipe(Effect.asVoid),
      }),
    )

    yield* deliverCoachNotifications().pipe(Effect.provide(repo))
    return {
      sent: yield* (yield* ManagerBotSender.TestService).sent(),
      delivered: yield* Ref.get(marks.delivered),
      deferred: yield* Ref.get(marks.deferred),
    }
  }).pipe(Effect.provide(ManagerBotSender.testLayer))

describe("coach notification delivery", () => {
  it.effect("tells the invite issuer when a coach finishes onboarding", () =>
    Effect.gen(function* () {
      const result = yield* run([notification("onboarding_complete")])

      expect(result.sent).toHaveLength(1)
      expect(result.sent[0]?.recipient).toBe(issuer)
      expect(result.sent[0]?.text).toContain("finished onboarding")
      expect(result.sent[0]?.text).toContain("Ada Coaching")
      expect(result.delivered).toEqual(["cbn_ada_onboarding_complete"])
    }),
  )

  it.effect("keeps the shipped bot-connected push saying what it always said", () =>
    Effect.gen(function* () {
      const result = yield* run([notification("bot_connected")])

      expect(result.sent[0]?.text).toBe("Coach bot @ada_coach_bot is connected to “Ada Coaching”.")
      expect(result.delivered).toEqual(["cbn_ada_bot_connected"])
    }),
  )

  it.effect("leaves a kind it does not recognise alone", () =>
    Effect.gen(function* () {
      const result = yield* run([notification("needs_relink")])

      // Delivering it with another kind's words would be worse than waiting: the
      // row keeps its lease and comes back on a later sweep, by which time the
      // deploy that enqueued it will know how to phrase it.
      expect(result.sent).toHaveLength(0)
      expect(result.delivered).toHaveLength(0)
      expect(result.deferred).toHaveLength(0)
    }),
  )

  it.effect("delivers each kind once when both are queued together", () =>
    Effect.gen(function* () {
      const result = yield* run([
        notification("bot_connected"),
        notification("onboarding_complete"),
      ])

      expect(result.sent).toHaveLength(2)
      expect(new Set(result.delivered)).toEqual(
        new Set(["cbn_ada_bot_connected", "cbn_ada_onboarding_complete"]),
      )
    }),
  )
})
