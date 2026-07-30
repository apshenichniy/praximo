import { describe, expect, it } from "vitest"

import { backAction } from "./back-navigation.ts"

/**
 * Back has been wrong in both directions on a real phone, so both are pinned.
 *
 * A deep link from a bot message opens its screen with an empty history, where
 * `back()` does nothing; and the fix for that, if it *pushes* the parent, leaves
 * the deep-linked screen behind the parent and back walks down into it again.
 */
describe("backAction", () => {
  it("uses the history when there is one", () => {
    expect(backAction({ canGoBack: true, fallbackTo: "/clients" })).toEqual({ kind: "history" })
  })

  it("goes up to the screen's parent when there is nothing behind it", () => {
    expect(backAction({ canGoBack: false, fallbackTo: "/clients" })).toEqual({
      kind: "replace",
      to: "/clients",
    })
  })

  it("replaces rather than pushes, so up cannot lead back down", () => {
    const action = backAction({ canGoBack: false, fallbackTo: "/sessions" })
    expect(action.kind).not.toBe("push")
    expect(action).toEqual({ kind: "replace", to: "/sessions" })
  })
})
