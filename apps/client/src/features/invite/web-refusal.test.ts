import { describe, expect, it } from "vitest"

import { webRefusal } from "./web-refusal.ts"

const NOW = new Date("2026-07-29T09:00:00.000Z")
const LATER = new Date("2026-08-05T09:00:00.000Z")
const EARLIER = new Date("2026-07-20T09:00:00.000Z")

/**
 * The four ways a link fails to open a door, on a surface that cannot tell who
 * is holding it.
 *
 * The bot separates "you are already set up" from "somebody else used this" by
 * comparing Telegram ids. The web has none — nobody is signed in, by design —
 * so that particular split is not available here and pretending otherwise would
 * mean inventing an identity to make a message sound more specific. What *is*
 * available is why the row stopped being usable, and that turns out to answer
 * the question the client actually has: is this done, replaced, or too late.
 */
describe("web refusal", () => {
  it("lets a live pending invitation through", () => {
    expect(webRefusal({ status: "pending", expiresAt: LATER, now: NOW })).toBeUndefined()
  })

  it("says an accepted link is already done", () => {
    expect(webRefusal({ status: "accepted", expiresAt: LATER, now: NOW })).toBe("already-accepted")
  })

  /**
   * A stored `expired` is not the clock running out — the coach reissued, which
   * is what `resetInvite` writes. The remedy differs from an expiry too: there is
   * already a newer link in the coach's hands, so "ask for the new one" is a real
   * instruction rather than a request to start something over.
   */
  it("tells a reissued link apart from one the clock caught", () => {
    expect(webRefusal({ status: "expired", expiresAt: LATER, now: NOW })).toBe("superseded")
    expect(webRefusal({ status: "pending", expiresAt: EARLIER, now: NOW })).toBe("expired")
  })

  /** Acceptance wins over the clock: a link walked through is done, not late. */
  it("prefers the accepted answer for a link that was used and then expired", () => {
    expect(webRefusal({ status: "accepted", expiresAt: EARLIER, now: NOW })).toBe(
      "already-accepted",
    )
  })

  /**
   * The boundary, stated rather than left to a reading of `<` versus `<=`: an
   * invitation whose `expires_at` is exactly now has run out. Seven days from
   * creation means seven days, and the tie goes to the door being shut.
   */
  it("closes the window at the instant it is reached", () => {
    expect(webRefusal({ status: "pending", expiresAt: NOW, now: NOW })).toBe("expired")
    expect(
      webRefusal({ status: "pending", expiresAt: new Date(NOW.getTime() + 1), now: NOW }),
    ).toBeUndefined()
  })
})
