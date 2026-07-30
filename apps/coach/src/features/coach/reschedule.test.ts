import { describe, expect, it } from "vitest"
import { ownSlot, reschedulePrefill, withoutOwnSlot } from "./reschedule.ts"

/**
 * The session being moved is not in its own way (#62).
 *
 * Pure, because the rule is about arithmetic on a day rather than about a
 * request: the server's own guard is tested against the database, and this is
 * the half that decides what the coach is *offered*.
 */

const KYIV = "Europe/Kyiv"

describe("ownSlot", () => {
  it("places the session on the coach's own day and minute", () => {
    // 07:00Z in July is 10:00 in Kyiv.
    expect(
      ownSlot({
        scheduledAt: "2026-07-27T07:00:00.000Z",
        durationMinutes: 60,
        timezone: KYIV,
      }),
    ).toEqual({ date: "2026-07-27", startMinutes: 600, durationMinutes: 60 })
  })

  it("reads a late instant as the coach's next day, not UTC's", () => {
    // 22:30Z on the 27th is 01:30 on the 28th in Kyiv.
    expect(
      ownSlot({
        scheduledAt: "2026-07-27T22:30:00.000Z",
        durationMinutes: 30,
        timezone: KYIV,
      }),
    ).toEqual({ date: "2026-07-28", startMinutes: 90, durationMinutes: 30 })
  })
})

describe("withoutOwnSlot", () => {
  const own = { date: "2026-07-27", startMinutes: 600, durationMinutes: 60 }
  const busy = [
    { startMinutes: 540, endMinutes: 570 },
    { startMinutes: 600, endMinutes: 660 },
    { startMinutes: 780, endMinutes: 840 },
  ]

  it("frees the interval the session itself holds", () => {
    expect(withoutOwnSlot(busy, own, "2026-07-27")).toEqual([
      { startMinutes: 540, endMinutes: 570 },
      { startMinutes: 780, endMinutes: 840 },
    ])
  })

  it("leaves every other day alone", () => {
    expect(withoutOwnSlot(busy, own, "2026-07-28")).toEqual(busy)
  })

  /**
   * A neighbour that merely starts at the same minute cannot exist — a workspace
   * forbids overlapping live sessions — but one whose *length* differs is a
   * session that was rescheduled elsewhere, and it must survive.
   */
  it("removes only the exact interval, never a merely adjacent one", () => {
    const shorter = [{ startMinutes: 600, endMinutes: 630 }]
    expect(withoutOwnSlot(shorter, own, "2026-07-27")).toEqual(shorter)
  })

  it("removes it once, even if the same interval somehow appears twice", () => {
    const twice = [
      { startMinutes: 600, endMinutes: 660 },
      { startMinutes: 600, endMinutes: 660 },
    ]
    expect(withoutOwnSlot(twice, own, "2026-07-27")).toHaveLength(1)
  })
})

describe("reschedulePrefill", () => {
  /** 09:00 in the coach's own day, so "earlier today" has something to mean. */
  const today = { date: "2026-07-27", minutes: 9 * 60 }

  it("opens a session still ahead on itself", () => {
    expect(
      reschedulePrefill({ date: "2026-07-29", startMinutes: 600, durationMinutes: 60 }, today),
    ).toEqual({ date: "2026-07-29", startMinutes: 600, durationMinutes: 60 })
  })

  it("opens a session later today on itself", () => {
    expect(
      reschedulePrefill({ date: "2026-07-27", startMinutes: 600, durationMinutes: 60 }, today),
    ).toEqual({ date: "2026-07-27", startMinutes: 600, durationMinutes: 60 })
  })

  /**
   * Today, but already gone by: the day is still where the coach is working, and
   * arming the button on a start the server answers `past` for is the one thing
   * this must not do.
   */
  it("keeps today but drops a start that has already passed", () => {
    expect(
      reschedulePrefill({ date: "2026-07-27", startMinutes: 8 * 60, durationMinutes: 60 }, today),
    ).toEqual({ date: "2026-07-27", durationMinutes: 60 })
    // The current minute itself is gone too — the grid only offers strictly ahead.
    expect(
      reschedulePrefill({ date: "2026-07-27", startMinutes: 9 * 60, durationMinutes: 60 }, today),
    ).toEqual({ date: "2026-07-27", durationMinutes: 60 })
  })

  /** A stale booking moves the day to today, with nothing picked. */
  it("opens a session from an earlier day on today, with no time chosen", () => {
    expect(
      reschedulePrefill({ date: "2026-07-20", startMinutes: 600, durationMinutes: 45 }, today),
    ).toEqual({ date: "2026-07-27", durationMinutes: 45 })
  })

  /**
   * No screen can book 11:47, but `bun db:demo` writes one — its offsets are
   * minutes from the run — and so would any row edited by hand. Opening on it
   * would put a button on screen whose only possible answer is `invalid`.
   */
  it("keeps the day but drops a start that is not on the grid", () => {
    expect(
      reschedulePrefill({ date: "2026-07-29", startMinutes: 707, durationMinutes: 60 }, today),
    ).toEqual({ date: "2026-07-29", durationMinutes: 60 })
  })

  /** A start on the grid but too late for its own length is refused the same way. */
  it("drops a start whose session would run past midnight", () => {
    expect(
      reschedulePrefill(
        { date: "2026-07-29", startMinutes: 23 * 60 + 45, durationMinutes: 60 },
        today,
      ),
    ).toEqual({ date: "2026-07-29", durationMinutes: 60 })
  })
})
