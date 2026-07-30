import { describe, expect, it } from "@effect/vitest"
import { isNotFound } from "@tanstack/react-router"
import { AdminSurface } from "./admin-surface.ts"
import { adminRefusal, notFoundWhenDenied, transportWord } from "./admin-transport.ts"
import { ViewerRole } from "./viewer-role.ts"

/** What the thrower actually threw, so a case can look at it rather than at a boolean. */
const thrownBy = (run: () => unknown): unknown => {
  try {
    run()
    return undefined
  } catch (error) {
    return error
  }
}

/**
 * The vocabulary of one real operation, spelled here so a case can be read
 * against the handler it stands for.
 */
const DELETE_WORDS = {
  "AdminSurface.ValidationFailed": "validation",
  "AdminSurface.DeletionConflict": "conflict",
  "AdminSurface.DeletionRetryable": "retryable",
  "AdminSurface.DeletionFailed": "blocked",
} as const

describe("the admin missing-page rule", () => {
  /**
   * The property a shared mapper is most likely to lose: `AccessDenied` is the one
   * refusal this whole tree answers with a missing page, and it must leave as a
   * *throw* rather than as a word an operation could name for itself.
   */
  it("turns AccessDenied into a missing page rather than a word", () => {
    expect(isNotFound(thrownBy(() => notFoundWhenDenied(new AdminSurface.AccessDenied())))).toBe(
      true,
    )
    // Even for an operation that names four other tags — the map cannot buy it out.
    expect(
      isNotFound(thrownBy(() => adminRefusal(new AdminSurface.AccessDenied(), DELETE_WORDS))),
    ).toBe(true)
  })

  it("lets every other failure past", () => {
    for (const error of [
      new AdminSurface.ValidationFailed(),
      new AdminSurface.LoadFailed({ operation: "listWorkspaces" }),
      new Error("boom"),
      { _tag: "AccessDenied" },
      undefined,
    ]) {
      expect(thrownBy(() => notFoundWhenDenied(error))).toBeUndefined()
    }
  })

  /**
   * The entry gate's half. `loadViewerRole` is the one admin endpoint that must
   * never answer with a missing page, so it takes the mapping without the rule —
   * and that has to stay true of `transportWord` itself, not just of how it
   * happens to be called.
   */
  it("is not applied by transportWord, which the entry gate uses alone", () => {
    expect(
      thrownBy(() => transportWord(new AdminSurface.AccessDenied(), DELETE_WORDS)),
    ).toBeUndefined()
    expect(transportWord(new AdminSurface.AccessDenied(), DELETE_WORDS)).toBe("server")
  })
})

describe("the word an admin operation answers with", () => {
  it("maps the tags it named and calls everything else server", () => {
    expect(adminRefusal(new AdminSurface.ValidationFailed(), DELETE_WORDS)).toBe("validation")
    expect(adminRefusal(new AdminSurface.DeletionConflict(), DELETE_WORDS)).toBe("conflict")
    expect(
      adminRefusal(new AdminSurface.DeletionRetryable({ operation: "pipeline" }), DELETE_WORDS),
    ).toBe("retryable")
    expect(
      adminRefusal(new AdminSurface.DeletionFailed({ operation: "bot-release" }), DELETE_WORDS),
    ).toBe("blocked")

    // Named by a *different* operation, so not this one's word to say.
    expect(adminRefusal(new AdminSurface.RenameConflict(), DELETE_WORDS)).toBe("server")
    expect(
      adminRefusal(new AdminSurface.LoadFailed({ operation: "deleteWorkspace" }), DELETE_WORDS),
    ).toBe("server")
    expect(adminRefusal(new Error("boom"), DELETE_WORDS)).toBe("server")
    expect(adminRefusal(undefined, DELETE_WORDS)).toBe("server")
    expect(adminRefusal({ _tag: 7 }, DELETE_WORDS)).toBe("server")
  })

  it("reads the entry gate's own tag, which no other operation names", () => {
    const gate = { "ViewerRole.Unauthenticated": "unauthenticated" } as const
    expect(transportWord(new ViewerRole.Unauthenticated(), gate)).toBe("unauthenticated")
    expect(transportWord(new ViewerRole.LoadFailed({ operation: "resolveRole" }), gate)).toBe(
      "server",
    )
  })
})
