import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { Workspace, WorkspaceId, WorkspaceNotFound } from "./workspace.ts"

const decodeId = Schema.decodeUnknownEffect(WorkspaceId)

describe("WorkspaceId", () => {
  it.effect("decodes a non-empty string", () =>
    Effect.gen(function* () {
      const id = yield* decodeId("ws_1")
      expect(id).toBe("ws_1")
    }),
  )

  it.effect("rejects an empty string", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodeId(""))
      expect(error._tag).toBe("SchemaError")
    }),
  )
})

describe("Workspace", () => {
  it.effect("decodes a well-formed workspace", () =>
    Effect.gen(function* () {
      const workspace = yield* Schema.decodeUnknownEffect(Workspace)({
        id: "ws_1",
        name: "Ada's practice",
      })
      expect(workspace.name).toBe("Ada's practice")
    }),
  )
})

describe("WorkspaceNotFound", () => {
  it("carries the workspace id it failed to find", () => {
    const error = new WorkspaceNotFound({ id: WorkspaceId.make("ws_1") })
    expect(error._tag).toBe("Domain.WorkspaceNotFound")
    expect(error.id).toBe("ws_1")
  })
})
