import { describe, expect, it } from "@effect/vitest"
import { DateTime, Effect, Schema } from "effect"
import {
  CreateInviteDelivery,
  CreateWorkspaceInput,
  narrowCoachLanguage,
  RenameWorkspaceInput,
} from "./workspace-create.ts"

const decode = Schema.decodeUnknownEffect(CreateWorkspaceInput)

describe("CreateWorkspaceInput", () => {
  it.effect("normalizes the workspace profile before creation", () =>
    Effect.gen(function* () {
      const input = yield* decode({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "  Ada Coaching  ",
        description: "   ",
        shortDescription: "  Thoughtful coaching  ",
      })

      expect(input).toEqual({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "Ada Coaching",
        shortDescription: "Thoughtful coaching",
      })
    }),
  )

  // The admin does not choose the coach's language, and an old client that
  // still sends one must not be able to set it by the back door (#130).
  it.effect("drops a coach language the caller tries to supply", () =>
    Effect.gen(function* () {
      const input = yield* decode({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "Ada Coaching",
        coachLanguage: "uk",
      })

      expect(input).toEqual({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "Ada Coaching",
      })
    }),
  )

  it.effect("accepts a bare request id: the internal label is optional", () =>
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

  it.effect("rejects malformed request ids", () =>
    Effect.gen(function* () {
      yield* Effect.flip(
        decode({
          requestId: "not-a-uuid",
          name: "Ada Coaching",
        }),
      )
    }),
  )

  it.effect("enforces optional description limits after trimming", () =>
    Effect.gen(function* () {
      const base = {
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        name: "Ada Coaching",
      }

      yield* Effect.flip(decode({ ...base, description: "a".repeat(513) }))
      yield* Effect.flip(decode({ ...base, shortDescription: "a".repeat(121) }))
    }),
  )
})

describe("narrowCoachLanguage", () => {
  it("narrows a Telegram language_code to one of the three the product speaks", () => {
    expect(narrowCoachLanguage("uk")).toBe("uk")
    // Regional tags are what Telegram actually sends.
    expect(narrowCoachLanguage("ru-RU")).toBe("ru")
    expect(narrowCoachLanguage("UK-ua")).toBe("uk")
    // Anything else is English rather than nothing: the bot and the Mini App
    // both have to say *something* to a sender they cannot place.
    expect(narrowCoachLanguage("de")).toBe("en")
    expect(narrowCoachLanguage("")).toBe("en")
    expect(narrowCoachLanguage(undefined)).toBe("en")
  })
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

describe("RenameWorkspaceInput", () => {
  const decodeRename = Schema.decodeUnknownEffect(RenameWorkspaceInput)

  it.effect("trims the internal label and keeps the concurrency check", () =>
    Effect.gen(function* () {
      const input = yield* decodeRename({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        expectedUpdatedAt: "2026-07-23T12:01:00.000Z",
        name: "  Ada Coaching  ",
      })

      expect(input).toEqual({
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        expectedUpdatedAt: DateTime.fromDateUnsafe(new Date("2026-07-23T12:01:00.000Z")),
        name: "Ada Coaching",
      })
    }),
  )

  it.effect("rejects malformed versions, request ids, and empty labels", () =>
    Effect.gen(function* () {
      const base = {
        requestId: "cb6bd559-6091-4d69-aeff-2af000354c7f",
        expectedUpdatedAt: "2026-07-23T12:01:00.000Z",
        name: "Ada Coaching",
      }

      yield* Effect.flip(decodeRename({ ...base, requestId: "not-a-uuid" }))
      yield* Effect.flip(decodeRename({ ...base, expectedUpdatedAt: "yesterday" }))
      yield* Effect.flip(decodeRename({ ...base, name: "   " }))
      yield* Effect.flip(decodeRename({ ...base, name: "a".repeat(65) }))
    }),
  )
})
