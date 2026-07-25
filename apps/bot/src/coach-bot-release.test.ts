import { describe, expect, it } from "@effect/vitest"
import { CoachBotProvisioningRepo } from "@praximo/db"
import { WorkspaceId } from "@praximo/domain"
import { CoachBotCredential, CoachBotRelease } from "@praximo/telegram"
import { Effect, Layer } from "effect"
import * as CoachBotReleaseLive from "./coach-bot-release.ts"

const workspaceId = WorkspaceId.make("019f9251-0000-7000-8000-000000000051")

const unsupported = () => Effect.die(new Error("unsupported test operation"))

const dependencies = (findByWorkspace: CoachBotProvisioningRepo.Interface["findByWorkspace"]) =>
  Layer.mergeAll(
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
        findInFlightManagedAttempt: unsupported,
        findByWorkspace,
        workspaceProfile: unsupported,
        rotate: unsupported,
        pendingNotifications: unsupported,
        markNotificationDelivered: unsupported,
        deferNotification: unsupported,
      }),
    ),
    Layer.succeed(
      CoachBotCredential.Service,
      CoachBotCredential.Service.of({
        encrypt: (token) => Effect.succeed(token),
        decrypt: (token) => Effect.succeed(token),
      }),
    ),
  )

const installed = (): CoachBotProvisioningRepo.Installation => ({
  workspaceId,
  telegramBotId: "5100",
  username: "workspace_51_bot",
  encryptedToken: "test-token",
  webhookSecretHash: "hash",
  botInfo: {},
})

const runRelease = (
  fetch: typeof globalThis.fetch,
  findByWorkspace: CoachBotProvisioningRepo.Interface["findByWorkspace"] = () =>
    Effect.succeed(installed()),
) =>
  Effect.gen(function* () {
    const release = yield* CoachBotRelease.Service
    return yield* release.release(workspaceId)
  }).pipe(
    Effect.provide(
      Layer.provideMerge(CoachBotReleaseLive.layerWithFetch(fetch), dependencies(findByWorkspace)),
    ),
  )

describe("CoachBotReleaseLive", () => {
  it.effect("deletes the webhook and drops pending updates", () => {
    const requests: Array<{ readonly url: string; readonly body: unknown }> = []
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push({
        url: input.toString(),
        body: JSON.parse(String(init?.body)),
      })
      return Response.json({ ok: true, result: true })
    }

    return Effect.gen(function* () {
      expect(yield* runRelease(fakeFetch)).toEqual(CoachBotRelease.Result.cases.Released.make({}))
      expect(requests).toEqual([
        {
          url: "https://api.telegram.org/bottest-token/deleteWebhook",
          body: { drop_pending_updates: true },
        },
      ])
    })
  })

  it.effect("does not call Telegram when the workspace has no connected bot", () => {
    let calls = 0
    const fakeFetch: typeof fetch = async () => {
      calls += 1
      return Response.json({ ok: true, result: true })
    }

    return Effect.gen(function* () {
      const result = yield* runRelease(fakeFetch, () =>
        Effect.fail(new CoachBotProvisioningRepo.InstallationNotFound({ key: workspaceId })),
      )
      expect(result).toEqual(CoachBotRelease.Result.cases.NotConnected.make({}))
      expect(calls).toBe(0)
    })
  })

  for (const code of [401, 404]) {
    it.effect(`treats Telegram ${code} as already released`, () =>
      Effect.gen(function* () {
        const result = yield* runRelease(async () =>
          Response.json({
            ok: false,
            error_code: code,
            description: "bot is already unavailable",
          }),
        )
        expect(result).toEqual(CoachBotRelease.Result.cases.AlreadyReleased.make({}))
      }),
    )
  }

  it.effect("marks Telegram 500 and transport failures as retryable", () =>
    Effect.gen(function* () {
      const botApiFailure = yield* runRelease(async () =>
        Response.json({
          ok: false,
          error_code: 500,
          description: "temporary Telegram failure",
        }),
      )
      const transportFailure = yield* runRelease(async () => {
        throw new Error("network unavailable")
      })

      expect(botApiFailure).toEqual(CoachBotRelease.Result.cases.Failed.make({ retryable: true }))
      expect(transportFailure).toEqual(
        CoachBotRelease.Result.cases.Failed.make({ retryable: true }),
      )
    }),
  )

  it.effect("marks an unexpected Telegram 400 as permanent", () =>
    Effect.gen(function* () {
      const result = yield* runRelease(async () =>
        Response.json({
          ok: false,
          error_code: 400,
          description: "invalid bot state",
        }),
      )

      expect(result).toEqual(CoachBotRelease.Result.cases.Failed.make({ retryable: false }))
    }),
  )
})
