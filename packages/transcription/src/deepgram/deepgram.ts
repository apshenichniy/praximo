import { Effect, Layer } from "effect"
import { Transcription } from "../transcription.ts"

/**
 * The Deepgram implementation of {@link Transcription.Service}. It lives behind
 * the `./deepgram` subpath so that choosing a provider is a wiring decision, not
 * an import that leaks through the rest of the codebase.
 *
 * Unwired until the STT ticket: submission needs the EU endpoint, the presigned
 * R2 URL, and the callback token scheme from ADR 0001.
 */
export const layer = Layer.sync(Transcription.Service, () => {
  const submit = Effect.fn("Deepgram.submit")(function* (request: Transcription.SubmitRequest) {
    return yield* Effect.fail(
      new Transcription.SubmissionFailed({
        audioKey: request.audioKey,
        reason: "the deepgram client is not wired yet",
      }),
    )
  })

  return Transcription.Service.of({ submit })
})

export * as Deepgram from "./deepgram.ts"
