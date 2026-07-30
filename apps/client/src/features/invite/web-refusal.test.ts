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
  it.each([
    ["open", { status: "pending", expiresAt: LATER, now: NOW }, undefined],
    ["accepted", { status: "accepted", expiresAt: LATER, now: NOW }, "already-accepted"],
    ["superseded", { status: "expired", expiresAt: LATER, now: NOW }, "superseded"],
    ["lapsed", { status: "pending", expiresAt: EARLIER, now: NOW }, "expired"],
  ] as const)("maps the %s standing into the web vocabulary", (_standing, input, expected) => {
    expect(webRefusal(input)).toBe(expected)
  })
})
