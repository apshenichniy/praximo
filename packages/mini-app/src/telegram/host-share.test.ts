import { afterEach, describe, expect, it, vi } from "vitest"

import { hostPlatform, isIosHost, shareViaSystem } from "./bridge.ts"

/**
 * The share sheet's gate (#27, #224).
 *
 * The whole point of these cases is that the answer comes from the **platform**
 * and never from `navigator.share`. Feature detection is wrong on three of the
 * four hosts, and each of them is wrong in a different way: Android's WebView
 * has no API at all, both Telegram Web clients expose one and refuse by
 * Permissions Policy, and Desktop's WebView2 resolves and does nothing. A
 * `typeof navigator.share === "function"` check would offer the button on two
 * hosts where it silently fails.
 */

/**
 * The suite runs in Node, where there is no `window` — so each case installs the
 * one it is about. `undefined` is the honest shape of "not inside Telegram at
 * all", which is also what a plain browser tab looks like.
 */
const hostRunning = (platform: string | undefined): void => {
  vi.stubGlobal("window", platform === undefined ? {} : { Telegram: { WebApp: { platform } } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the host we are running in", () => {
  it("offers the share sheet on iOS and nowhere else", () => {
    hostRunning("ios")
    expect(isIosHost()).toBe(true)

    for (const platform of ["android", "tdesktop", "macos", "weba", "webk"]) {
      hostRunning(platform)
      expect(isIosHost(), platform).toBe(false)
    }
  })

  it("says nothing outside a Telegram host at all", () => {
    hostRunning(undefined)
    expect(hostPlatform()).toBeUndefined()
    expect(isIosHost()).toBe(false)
  })

  /**
   * The gate is the platform, so an Android WebView advertising `navigator.share`
   * — which it does not, but a future one might — still gets no button. Asserting
   * this pins the decision to the host rather than to the API's presence.
   */
  it("stays shut on a non-iOS host that happens to expose the API", () => {
    hostRunning("android")
    vi.stubGlobal("navigator", { share: () => Promise.resolve() })
    expect(isIosHost()).toBe(false)
  })
})

describe("the system share sheet", () => {
  it("reports a share the coach went through with", async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { share })

    expect(await shareViaSystem("Hi Anna!\n\nhttps://me.praximo.io/i/ABCDEFGH2345")).toBe("shared")
    expect(share).toHaveBeenCalledWith({
      text: "Hi Anna!\n\nhttps://me.praximo.io/i/ABCDEFGH2345",
    })
  })

  // A cancelled sheet is a coach changing their mind, not a failure — and it is
  // emphatically not a delivery, which is the distinction the caller acts on.
  it("tells a cancelled sheet apart from a broken one", async () => {
    const abort = new Error("cancelled")
    abort.name = "AbortError"
    vi.stubGlobal("navigator", { share: () => Promise.reject(abort) })
    expect(await shareViaSystem("anything")).toBe("dismissed")

    vi.stubGlobal("navigator", { share: () => Promise.reject(new Error("nope")) })
    expect(await shareViaSystem("anything")).toBe("unsupported")
  })

  it("reports a host with no share sheet rather than throwing", async () => {
    vi.stubGlobal("navigator", {})
    expect(await shareViaSystem("anything")).toBe("unsupported")
  })
})
