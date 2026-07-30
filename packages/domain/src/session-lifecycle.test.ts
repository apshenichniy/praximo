import { describe, expect, it } from "vitest"
import { sessionStillAhead } from "./session-lifecycle.ts"

/**
 * The one rule that decides which of the two views a session belongs to (#232),
 * and the reason it is a predicate rather than a filter written twice.
 *
 * Upcoming and Past are complements: whatever this says is not ahead **is** the
 * history, so a session that falls out of one has to fall into the other. The
 * four cases below are that partition — a state that still holds a slot crossed
 * with the floor, and a terminal state which is history whichever side of the
 * floor it sits on.
 */
const FLOOR = new Date("2026-07-27T00:00:00.000Z")
const BEFORE = new Date("2026-07-26T10:00:00.000Z")
const AFTER = new Date("2026-07-28T10:00:00.000Z")

describe("sessionStillAhead", () => {
  it("keeps a live session that has not passed the floor", () => {
    expect(sessionStillAhead("scheduled", AFTER, FLOOR)).toBe(true)
    expect(sessionStillAhead("in_progress", AFTER, FLOOR)).toBe(true)
    // The floor itself is ahead: Today's own day starts on it, and a session at
    // 00:00 belongs to the day the coach is looking at.
    expect(sessionStillAhead("scheduled", FLOOR, FLOOR)).toBe(true)
  })

  /**
   * Every session conducted before #42's reconciler exists is exactly this row:
   * still `scheduled`, and over. Without it here it would be in neither view.
   */
  it("lets go of a live session the floor has passed", () => {
    expect(sessionStillAhead("scheduled", BEFORE, FLOOR)).toBe(false)
    expect(sessionStillAhead("in_progress", BEFORE, FLOOR)).toBe(false)
  })

  /**
   * A cancellation next week is history the moment it is written: it is what
   * happened, and the one thing certain about it is that it will not happen.
   */
  it("treats a terminal session as history whichever side of the floor it is on", () => {
    expect(sessionStillAhead("cancelled", AFTER, FLOOR)).toBe(false)
    expect(sessionStillAhead("completed", AFTER, FLOOR)).toBe(false)
    expect(sessionStillAhead("cancelled", BEFORE, FLOOR)).toBe(false)
    expect(sessionStillAhead("completed", BEFORE, FLOOR)).toBe(false)
  })
})
