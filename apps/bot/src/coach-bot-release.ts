import { CoachBotProvisioningRepo } from "@praximo/db"
import { CoachBotRelease, CoachBotCredential } from "@praximo/telegram"
import { Api, GrammyError, HttpError } from "grammy"
import { Effect, Layer, Result } from "effect"

const failed = (retryable: boolean): CoachBotRelease.Result =>
  CoachBotRelease.Result.cases.Failed.make({ retryable })

const telegramFailure = (cause: unknown): CoachBotRelease.Result => {
  if (cause instanceof GrammyError) {
    if (cause.error_code === 401 || cause.error_code === 404) {
      return CoachBotRelease.Result.cases.AlreadyReleased.make({})
    }
    return failed(cause.error_code >= 500)
  }
  return failed(cause instanceof HttpError || cause instanceof Error)
}

const makeLayer = (fetch?: typeof globalThis.fetch) =>
  Layer.effect(
    CoachBotRelease.Service,
    Effect.gen(function* () {
      const installations = yield* CoachBotProvisioningRepo.Service
      const credentials = yield* CoachBotCredential.Service

      const release = Effect.fn("CoachBotRelease.Live.release")(function* (workspaceId) {
        const installed = yield* installations.findByWorkspace(workspaceId).pipe(Effect.result)
        if (Result.isFailure(installed)) {
          return installed.failure._tag === "CoachBotProvisioningRepo.InstallationNotFound"
            ? CoachBotRelease.Result.cases.NotConnected.make({})
            : failed(true)
        }

        const token = yield* credentials
          .decrypt(installed.success.encryptedToken)
          .pipe(Effect.result)
        if (Result.isFailure(token)) return failed(true)

        const api = new Api(token.success, fetch === undefined ? undefined : { fetch })
        const deleted = yield* Effect.tryPromise({
          try: () => api.deleteWebhook({ drop_pending_updates: true }),
          catch: telegramFailure,
        }).pipe(Effect.result)

        return Result.isSuccess(deleted)
          ? CoachBotRelease.Result.cases.Released.make({})
          : deleted.failure
      })

      return CoachBotRelease.Service.of({ release })
    }),
  )

export const layer = makeLayer()

export const layerWithFetch = (fetch: typeof globalThis.fetch) => makeLayer(fetch)
