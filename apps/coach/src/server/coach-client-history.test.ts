import type { ClientRepo } from "@praximo/db"
import { describe, expect, it } from "vitest"

import { splitSessions } from "./coach-clients.ts"

/**
 * How one client's calendar becomes the two fields their route reads (#232).
 *
 * The rule is `sessionStillAhead`, which has its own suite in `@praximo/domain`;
 * what this one owns is the *floor* and the *order* — the two things the client
 * route could get wrong on its own while the predicate stayed right.
 */

/** 06:00 UTC on the 27th; in Kyiv the coach's day began at 21:00 UTC the 26th. */
const DAY_FLOOR = new Date("2026-07-26T21:00:00.000Z")

const row = (
  over: Partial<ClientRepo.ClientSessionRow> & { readonly id: string },
): ClientRepo.ClientSessionRow => ({
  scheduledAt: new Date("2026-07-27T07:00:00.000Z"),
  durationMinutes: 60,
  kind: "regular",
  state: "scheduled",
  ...over,
})

/** The repository's own order: newest first. */
const newestFirst = (
  rows: ReadonlyArray<ClientRepo.ClientSessionRow>,
): ReadonlyArray<ClientRepo.ClientSessionRow> =>
  // In-place on a copy made right here, and the ES2022 target has no `toSorted`.
  // oxlint-disable-next-line unicorn/no-array-sort
  [...rows].sort((left, right) => right.scheduledAt.getTime() - left.scheduledAt.getTime())

describe("splitSessions", () => {
  it("puts what is ahead in order and what is behind in reverse", () => {
    const split = splitSessions(
      newestFirst([
        row({ id: "se_soon", scheduledAt: new Date("2026-07-28T07:00:00.000Z") }),
        row({ id: "se_later", scheduledAt: new Date("2026-08-04T07:00:00.000Z") }),
        row({
          id: "se_done",
          scheduledAt: new Date("2026-07-20T07:00:00.000Z"),
          state: "completed",
        }),
        row({
          id: "se_off",
          scheduledAt: new Date("2026-07-24T07:00:00.000Z"),
          state: "cancelled",
          cancelReason: "no_show",
        }),
      ]),
      DAY_FLOOR,
    )

    expect(split.sessions.map((entry) => entry.id)).toEqual(["se_soon", "se_later"])
    expect(split.past.map((entry) => entry.id)).toEqual(["se_off", "se_done"])
    expect(split.past[0]).toMatchObject({ state: "cancelled", cancelReason: "no_show" })
    // What is ahead says nothing about itself, so it carries no state at all.
    expect(split.sessions[0]).not.toHaveProperty("state")
  })

  /**
   * The floor is the coach's **day**, the same instant the sessions list is cut
   * at — not this minute.
   *
   * Cutting at the minute read a session that started at eleven as history while
   * `/sessions` still had it under Upcoming, and put a session running right now
   * under «Прошедшие сессии» — where it would print no sentence, because nothing
   * has become of it yet.
   */
  it("keeps a session that has already started today out of the history", () => {
    const split = splitSessions(
      [row({ id: "se_running", scheduledAt: new Date("2026-07-27T05:00:00.000Z") })],
      DAY_FLOOR,
    )

    expect(split.sessions.map((entry) => entry.id)).toEqual(["se_running"])
    expect(split.past).toEqual([])
  })

  /** A cancellation booked for next week is history the moment it is written. */
  it("reads a terminal session as history whichever side of the floor it is on", () => {
    const split = splitSessions(
      [
        row({
          id: "se_off",
          scheduledAt: new Date("2026-08-04T07:00:00.000Z"),
          state: "cancelled",
          cancelReason: "coach_cancelled",
        }),
      ],
      DAY_FLOOR,
    )

    expect(split.sessions).toEqual([])
    expect(split.past.map((entry) => entry.id)).toEqual(["se_off"])
  })

  /**
   * A session left `scheduled` after its hour — which, until #42's reconciler
   * exists, is what every conducted session looks like. Without this it would be
   * on no surface at all, and the intake switch would read the client as
   * somebody the coach had never met.
   */
  it("does not lose a session whose day has gone while it was still scheduled", () => {
    const split = splitSessions(
      [row({ id: "se_stale", scheduledAt: new Date("2026-07-20T07:00:00.000Z") })],
      DAY_FLOOR,
    )

    expect(split.sessions).toEqual([])
    expect(split.past.map((entry) => entry.id)).toEqual(["se_stale"])
  })
})
