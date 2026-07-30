import { describe, expect, it } from "vitest"
import { sessionDraft } from "./session-draft.ts"

/**
 * The rules both writes share (#62), at a fixed instant.
 *
 * Pure and instant-fixed on purpose: "has this time already gone by" and "which
 * instant does 10:00 in Kyiv name" are exactly the two questions that go wrong
 * an offset at a time, and neither is observable through a repository test.
 */
const KYIV = "Europe/Kyiv"
/** Monday 27 July 2026, 09:00 in Kyiv — 06:00 UTC. */
const NOW = Date.parse("2026-07-27T06:00:00.000Z")

const draft = (overrides: Partial<Parameters<typeof sessionDraft>[0]> = {}) =>
  sessionDraft({
    date: "2026-07-27",
    startMinutes: 10 * 60,
    durationMinutes: 60,
    timezone: KYIV,
    nowMillis: NOW,
    ...overrides,
  })

describe("sessionDraft", () => {
  it("resolves a wall-clock start into the instant it names in the coach's zone", () => {
    // 10:00 in Kyiv is 07:00 UTC in July. Storing the reading instead would put
    // every session three hours out and make the day query read the wrong day.
    expect(draft()).toEqual({ ok: true, at: new Date("2026-07-27T07:00:00.000Z") })
  })

  it("refuses a start that is not on the grid", () => {
    expect(draft({ startMinutes: 10 * 60 + 7 })).toEqual({ ok: false, reason: "invalid" })
  })

  it("refuses a length the product does not plan", () => {
    expect(draft({ durationMinutes: 90 })).toEqual({ ok: false, reason: "invalid" })
    expect(draft({ durationMinutes: -1 })).toEqual({ ok: false, reason: "invalid" })
  })

  it("refuses a session that would run past midnight", () => {
    expect(draft({ startMinutes: 23 * 60 + 45, durationMinutes: 60 })).toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  it("refuses a date that is not one", () => {
    expect(draft({ date: "not-a-day" })).toEqual({ ok: false, reason: "invalid" })
  })

  it("tells a start already gone by from one still ahead", () => {
    // 08:00 Kyiv is an hour before "now"; 09:00 is now itself, which the screen
    // never offers and this refuses for the same reason.
    expect(draft({ startMinutes: 8 * 60 })).toEqual({ ok: false, reason: "past" })
    expect(draft({ startMinutes: 9 * 60 })).toEqual({ ok: false, reason: "past" })
    expect(draft({ startMinutes: 9 * 60 + 15 })).toMatchObject({ ok: true })
  })

  /**
   * The zone is the coach's, not the server's: the same wall-clock start means
   * different instants in different practices, and «past» has to follow.
   */
  it("reads the same wall clock differently in a different zone", () => {
    const kyiv = draft({ date: "2026-07-27", startMinutes: 10 * 60 })
    const lisbon = draft({ date: "2026-07-27", startMinutes: 10 * 60, timezone: "Europe/Lisbon" })
    expect(kyiv).toEqual({ ok: true, at: new Date("2026-07-27T07:00:00.000Z") })
    expect(lisbon).toEqual({ ok: true, at: new Date("2026-07-27T09:00:00.000Z") })
  })

  /**
   * Across a daylight-saving change the offset moves, so a start resolved with
   * yesterday's offset would land an hour out. Kyiv goes to winter time on the
   * last Sunday of October.
   */
  it("follows a daylight-saving change rather than a fixed offset", () => {
    const summer = sessionDraft({
      date: "2026-10-24",
      startMinutes: 10 * 60,
      durationMinutes: 60,
      timezone: KYIV,
      nowMillis: NOW,
    })
    const winter = sessionDraft({
      date: "2026-10-26",
      startMinutes: 10 * 60,
      durationMinutes: 60,
      timezone: KYIV,
      nowMillis: NOW,
    })
    expect(summer).toEqual({ ok: true, at: new Date("2026-10-24T07:00:00.000Z") })
    expect(winter).toEqual({ ok: true, at: new Date("2026-10-26T08:00:00.000Z") })
  })
})
