import { describe, expect, it } from "@effect/vitest"
import { WorkspaceId } from "@praximo/domain"
import { Effect } from "effect"
import { WorkspaceRepo } from "./workspace-repo.ts"

describe("WorkspaceRepo", () => {
  it.effect("reports that the database is unwired instead of inventing a workspace", () =>
    Effect.gen(function* () {
      const repo = yield* WorkspaceRepo.Service
      const error = yield* Effect.flip(repo.findById(WorkspaceId.make("ws_1")))

      if (error._tag !== "WorkspaceRepo.QueryFailed") {
        throw new Error(`expected a QueryFailed, got ${error._tag}`)
      }

      expect(error.operation).toBe("findById")
    }).pipe(Effect.provide(WorkspaceRepo.layer)),
  )
})
