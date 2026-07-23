import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { CreateWorkspaceInput } from "./workspace-create.ts"

const decode = Schema.decodeUnknownEffect(CreateWorkspaceInput)

describe("CreateWorkspaceInput", () => {
  it.effect("normalizes the workspace profile before creation", () =>
    Effect.gen(function* () {
      const input = yield* decode({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "  Ada Coaching  ",
        coachLanguage: "uk",
        description: "   ",
        shortDescription: "  Thoughtful coaching  ",
      })

      expect(input).toEqual({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "Ada Coaching",
        coachLanguage: "uk",
        shortDescription: "Thoughtful coaching",
      })
    }),
  )

  it.effect("rejects missing, blank, and oversized workspace names", () =>
    Effect.gen(function* () {
      const base = {
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        coachLanguage: "en",
      }

      yield* Effect.flip(decode(base))
      yield* Effect.flip(decode({ ...base, name: "   " }))
      yield* Effect.flip(decode({ ...base, name: "a".repeat(65) }))
    }),
  )

  it.effect("rejects unsupported languages and malformed request ids", () =>
    Effect.gen(function* () {
      yield* Effect.flip(
        decode({
          requestId: "not-a-uuid",
          name: "Ada Coaching",
          coachLanguage: "es",
        }),
      )
    }),
  )

  it.effect("enforces optional description limits after trimming", () =>
    Effect.gen(function* () {
      const base = {
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "Ada Coaching",
        coachLanguage: "ru",
      }

      yield* Effect.flip(decode({ ...base, description: "a".repeat(513) }))
      yield* Effect.flip(decode({ ...base, shortDescription: "a".repeat(121) }))
    }),
  )
})
