import { describe, expect, it } from "@effect/vitest"
import { DateTime, Effect, Schema } from "effect"
import {
  CreateInviteDelivery,
  CreateWorkspaceInput,
  UpdateWorkspaceProfileInput,
} from "./workspace-create.ts"

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

  it.effect("accepts a bare request id: name and coach language are optional", () =>
    Effect.gen(function* () {
      const input = yield* decode({ requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f" })
      expect(input).toEqual({ requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f" })

      const blankName = yield* decode({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "   ",
      })
      expect(blankName).toEqual({ requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f" })
    }),
  )

  it.effect("rejects oversized workspace names", () =>
    Effect.gen(function* () {
      yield* Effect.flip(
        decode({ requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f", name: "a".repeat(65) }),
      )
    }),
  )

  it.effect("rejects unsupported languages and malformed request ids", () =>
    Effect.gen(function* () {
      yield* Effect.flip(
        decode({
          requestId: "not-a-uuid",
          name: "Ada Coaching",
        }),
      )
      yield* Effect.flip(
        decode({
          requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
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

describe("CreateInviteDelivery", () => {
  const decodeDelivery = Schema.decodeUnknownEffect(CreateInviteDelivery)

  it.effect("accepts the shippable channels with an invite language", () =>
    Effect.gen(function* () {
      expect(yield* decodeDelivery({ channel: "copy", language: "en" })).toEqual({
        channel: "copy",
        language: "en",
      })
      expect(yield* decodeDelivery({ channel: "telegram", language: "ru" })).toEqual({
        channel: "telegram",
        language: "ru",
      })
    }),
  )

  it.effect("rejects unknown channels and languages", () =>
    Effect.gen(function* () {
      yield* Effect.flip(decodeDelivery({ channel: "email", language: "en" }))
      yield* Effect.flip(decodeDelivery({ channel: "copy", language: "es" }))
      yield* Effect.flip(decodeDelivery({ channel: "copy" }))
    }),
  )
})

describe("UpdateWorkspaceProfileInput", () => {
  const decodeUpdate = Schema.decodeUnknownEffect(UpdateWorkspaceProfileInput)

  it.effect("normalizes editable fields and preserves explicit avatar intent", () =>
    Effect.gen(function* () {
      const input = yield* decodeUpdate({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        expectedUpdatedAt: "2026-07-23T12:01:00.000Z",
        name: "  Ada Coaching  ",
        description: "   ",
        shortDescription: "  Calm, useful coaching  ",
        avatarIntent: "reset",
      })

      expect(input).toEqual({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        expectedUpdatedAt: DateTime.fromDateUnsafe(new Date("2026-07-23T12:01:00.000Z")),
        name: "Ada Coaching",
        shortDescription: "Calm, useful coaching",
        avatarIntent: "reset",
      })
    }),
  )

  it.effect("rejects malformed versions, request ids, and avatar intents", () =>
    Effect.gen(function* () {
      const base = {
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        expectedUpdatedAt: "2026-07-23T12:01:00.000Z",
        name: "Ada Coaching",
        avatarIntent: "keep",
      }

      yield* Effect.flip(decodeUpdate({ ...base, requestId: "not-a-uuid" }))
      yield* Effect.flip(decodeUpdate({ ...base, expectedUpdatedAt: "yesterday" }))
      yield* Effect.flip(decodeUpdate({ ...base, avatarIntent: "remove" }))
    }),
  )
})
