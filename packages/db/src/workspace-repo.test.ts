import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { WorkspaceRepo } from "./workspace-repo.ts"

describe("WorkspaceRepo.decodeRow", () => {
  it.effect("decodes a persisted row into the domain entity", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceRepo.decodeRow({ id: "ws_1", name: "Ada's practice" })

      expect(workspace.id).toBe("ws_1")
      expect(workspace.name).toBe("Ada's practice")
    }),
  )

  it.effect("rejects a row the domain would not accept", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(WorkspaceRepo.decodeRow({ id: "", name: "Ada's practice" }))

      expect(error._tag).toBe("SchemaError")
    }),
  )
})
