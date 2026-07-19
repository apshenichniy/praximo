import { Context, Effect, Layer, Schema } from "effect"

/**
 * Generates the analysis Artifacts a session produces (CONTEXT.md): Brief,
 * Debrief, and Mentor Review. Prompts and the Vercel AI SDK live here; the
 * pipeline's workflow steps stay thin and call this service (ADR 0002).
 */
export interface Interface {
  readonly generate: (request: GenerateRequest) => Effect.Effect<string, GenerationFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/analysis/ArtifactGenerator",
) {}

/** The MVP kinds. The set is open — CONTEXT.md treats Artifact kinds as extensible. */
export const ArtifactKind = Schema.Literals(["brief", "debrief", "mentorReview"])

export type ArtifactKind = typeof ArtifactKind.Type

export const GenerateRequest = Schema.Struct({
  kind: ArtifactKind,
  transcriptKey: Schema.NonEmptyString,
})

export interface GenerateRequest extends Schema.Schema.Type<typeof GenerateRequest> {}

export class GenerationFailed extends Schema.TaggedErrorClass<GenerationFailed>()(
  "ArtifactGenerator.GenerationFailed",
  {
    kind: Schema.String,
    reason: Schema.String,
  },
) {}

/**
 * Unwired until the artifact-template tickets: generation needs the prompts, the
 * ICF material, and an AI Gateway model binding.
 */
export const layer = Layer.sync(Service, () => {
  const generate = Effect.fn("ArtifactGenerator.generate")(function* (request: GenerateRequest) {
    return yield* Effect.fail(
      new GenerationFailed({
        kind: request.kind,
        reason: "artifact generation is not wired yet",
      }),
    )
  })

  return Service.of({ generate })
})

export * as ArtifactGenerator from "./artifact-generator.ts"
