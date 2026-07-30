import { describe, expect, it } from "@effect/vitest"
import { ClientAcceptanceRepo, CoachBotProvisioningRepo } from "@praximo/db"
import { CoachLanguage, TelegramId, WorkspaceId } from "@praximo/domain"
import { BotRegistry, ManagerBotSender } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer, Ref } from "effect"
import { unusedCredential, unusedHealthRepo } from "./__tests__/coach-bot-provisioning.ts"
import { uploadsStub } from "./__tests__/uploads.ts"
import { CoachBotProvisioning } from "./coach-bot-provisioning.ts"

const unsupported = () => Effect.die(new Error("unsupported test operation"))

const issuer = TelegramId.make("100000001")
const coach = TelegramId.make("100000002")

const notification = (
  kind: string,
  overrides: Partial<CoachBotProvisioningRepo.PendingNotification> = {},
): CoachBotProvisioningRepo.PendingNotification => ({
  id: `cbn_ada_${kind}`,
  workspaceId: WorkspaceId.make("ws_ada"),
  kind,
  recipientRole: "admin",
  recipientTelegramId: issuer,
  dedupeKey: `${kind}:ws_ada`,
  workspaceName: "Ada Coaching",
  botUsername: "ada_coach_bot",
  coachLanguage: CoachLanguage.make("en"),
  attemptCount: 0,
  ...overrides,
})

interface Marks {
  readonly delivered: Ref.Ref<ReadonlyArray<string>>
  readonly deferred: Ref.Ref<ReadonlyArray<string>>
}

const env = {
  MANAGER_BOT_TOKEN: "manager-token",
  MANAGER_BOT_USERNAME: "PraximoManagerBot",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: "branding/default-coach-avatar.jpg",
  COACH_MINI_APP_URL: "https://coach.praximo.io/",
}

/** The client-accepted push reads one client; every other kind reads none. */
const clientsLayer = Layer.succeed(
  ClientAcceptanceRepo.Service,
  ClientAcceptanceRepo.Service.of({
    findByToken: unsupported,
    findByWebToken: unsupported,
    findBotOwner: unsupported,
    findAcceptedClient: (clientId) =>
      Effect.succeed(
        clientId === "cl_maria"
          ? { id: clientId, name: "Maria K.", language: "ru" as const, telegramUsername: "maria" }
          : undefined,
      ),
    claim: unsupported,
  }),
)

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
        reopenForRelink: unsupported,
        findByBotId: unsupported,
        findInFlightManagedAttempt: unsupported,
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

    const dependencies = Layer.mergeAll(
      repo,
      clientsLayer,
      unusedHealthRepo,
      unusedCredential,
      ManagerBotSender.testLayer,
      BotRegistry.testLayer,
    )
    return yield* Effect.gen(function* () {
      yield* Effect.flatMap(CoachBotProvisioning.Service, (service) =>
        service.deliverCoachNotifications(),
      )
      return {
        sent: yield* (yield* ManagerBotSender.TestService).sent(),
        throughCoachBot: yield* (yield* BotRegistry.TestService).sent(),
        delivered: yield* Ref.get(marks.delivered),
        deferred: yield* Ref.get(marks.deferred),
      }
    }).pipe(
      Effect.provide(
        CoachBotProvisioning.testLayer(uploadsStub().bucket, globalThis.fetch).pipe(
          Layer.provideMerge(dependencies),
        ),
      ),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    )
  })

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
      const result = yield* run([notification("some_future_push")])

      // Delivering it with another kind's words would be worse than waiting: the
      // row keeps its lease and comes back on a later sweep, by which time the
      // deploy that enqueued it will know how to phrase it.
      expect(result.sent).toHaveLength(0)
      expect(result.delivered).toHaveLength(0)
      expect(result.deferred).toHaveLength(0)
    }),
  )

  it.effect("leaves a kind it only knows for the other recipient alone", () =>
    Effect.gen(function* () {
      // `bot_repaired` is coach-facing and has no admin words at all. Selecting
      // copy on the kind alone would hand the admin the coach's message.
      const result = yield* run([notification("bot_repaired")])

      expect(result.sent).toHaveLength(0)
      expect(result.delivered).toHaveLength(0)
    }),
  )

  it.effect("tells the admin an outage happened, and that it is not theirs to fix", () =>
    Effect.gen(function* () {
      const result = yield* run([notification("needs_relink")])

      expect(result.sent[0]?.text).toContain("stopped working")
      expect(result.sent[0]?.text).toContain("no action is needed from you")
      expect(result.delivered).toEqual(["cbn_ada_needs_relink"])
    }),
  )

  it.effect("tells the admin when the coach closes the loop", () =>
    Effect.gen(function* () {
      const result = yield* run([notification("relink_completed")])

      expect(result.sent[0]?.text).toBe(
        "“Ada Coaching” is back online — the coach reconnected @ada_coach_bot.",
      )
    }),
  )

  it.effect("speaks to the coach in their own language, not the admin's English", () =>
    Effect.gen(function* () {
      const result = yield* run([
        notification("needs_relink", {
          recipientRole: "coach",
          recipientTelegramId: coach,
          coachLanguage: CoachLanguage.make("uk"),
        }),
      ])

      expect(result.sent[0]?.recipient).toBe(coach)
      expect(result.sent[0]?.text).toContain("Ваш бот @ada_coach_bot перестав працювати")
      // Sent through the manager bot on purpose: the coach's own bot is the
      // thing that broke, so it cannot carry its own bad news (ADR 0004).
      expect(result.sent).toHaveLength(1)
    }),
  )

  it.effect("tells a coach whose bot repaired itself what a real disconnect takes", () =>
    Effect.gen(function* () {
      const result = yield* run([
        notification("bot_repaired", {
          recipientRole: "coach",
          recipientTelegramId: coach,
          coachLanguage: CoachLanguage.make("ru"),
        }),
      ])

      expect(result.sent[0]?.text).toContain("восстановлена автоматически")
      expect(result.sent[0]?.text).toContain("@BotFather")
    }),
  )

  // The one event that happens without the coach in the room, and the only
  // push that leaves through the coach's own bot: that is the chat the client
  // just appeared in, and a `web_app` button only opens the app from there.
  it.effect("tells the coach through their own bot when a client accepts", () =>
    Effect.gen(function* () {
      const result = yield* run([
        notification("client_accepted", {
          recipientRole: "coach",
          recipientTelegramId: coach,
          dedupeKey: "client_accepted:ws_ada:cl_maria",
          coachLanguage: CoachLanguage.make("ru"),
        }),
      ])

      expect(result.sent).toHaveLength(0)
      expect(result.throughCoachBot[0]?.text).toContain("Maria K.")
      expect(result.throughCoachBot[0]?.text).toContain("@maria")
      expect(result.delivered).toEqual(["cbn_ada_client_accepted"])
    }),
  )

  // A row whose client has since been deleted must not be delivered with a
  // missing name, and must not be dropped either — it comes back next sweep.
  it.effect("defers a client-accepted push it cannot describe yet", () =>
    Effect.gen(function* () {
      const result = yield* run([
        notification("client_accepted", {
          recipientRole: "coach",
          dedupeKey: "client_accepted:ws_ada:cl_gone",
        }),
      ])

      expect(result.throughCoachBot).toHaveLength(0)
      expect(result.deferred).toEqual(["cbn_ada_client_accepted"])
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
