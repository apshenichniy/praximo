import { Context, Effect, Schema } from "effect"

/**
 * Provider-agnostic speech-to-text. The provider is chosen by layer at pipeline
 * wiring time (ADR 0002) — nothing outside `./deepgram` knows which one it is.
 *
 * Audio moves by reference: a submission carries an R2 key, never bytes
 * (ADR 0001's pass-by-reference discipline).
 */
export interface Interface {
  readonly submit: (request: SubmitRequest) => Effect.Effect<SubmissionId, SubmissionFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/transcription/Transcription",
) {}

export const SubmissionId = Schema.NonEmptyString.pipe(Schema.brand("SubmissionId"))

export type SubmissionId = typeof SubmissionId.Type

export const SubmitRequest = Schema.Struct({
  audioKey: Schema.NonEmptyString,
  callbackUrl: Schema.NonEmptyString,
})

export interface SubmitRequest extends Schema.Schema.Type<typeof SubmitRequest> {}

export class SubmissionFailed extends Schema.TaggedErrorClass<SubmissionFailed>()(
  "Transcription.SubmissionFailed",
  {
    audioKey: Schema.String,
    reason: Schema.String,
  },
) {}

export * as Transcription from "./transcription.ts"
