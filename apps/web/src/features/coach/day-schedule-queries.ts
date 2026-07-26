import { queryOptions } from "@tanstack/react-query"

import type { DayScheduleData } from "@/features/coach/components/scheduling-screen.tsx"
import { getDaySchedule } from "@/server/coach-clients.functions.ts"

/**
 * One day's bookings, cached (#186).
 *
 * The scheduling screen used to read the day straight from a `useEffect`, which
 * meant a coach comparing Tuesday against Wednesday paid a round-trip and a
 * skeleton for every glance — including the trip back to a day they had just
 * looked at. Cached per date, those glances are free after the first.
 *
 * A day is *not* immutable: a session can be booked from the bot, from another
 * device, or by this screen a moment ago. So the cache is short-lived and
 * cleared outright once a booking lands — a stale free slot is the one thing
 * this screen must never show, because the coach would then be offered a start
 * the server has already refused.
 */
export const dayScheduleKeys = {
  all: ["coach", "day-schedule"] as const,
  day: (date: string) => [...dayScheduleKeys.all, date] as const,
}

/**
 * Long enough that flipping between two days does not touch the network, short
 * enough that a day left on screen while a session is booked elsewhere is
 * re-read the next time it is looked at.
 */
const DayScheduleStaleMs = 30_000

/** What a day reads as when the server will not answer at all. */
export const UnknownDaySchedule: DayScheduleData = { busy: [], timezone: "UTC" }

export const daySchedule = (date: string) =>
  queryOptions({
    queryKey: dayScheduleKeys.day(date),
    queryFn: async (): Promise<DayScheduleData> => {
      const result = await getDaySchedule({ data: { date } })
      // Thrown rather than swallowed, so a failed read is retried and — until
      // it succeeds — is not remembered as "this day has nothing on it".
      if (!result.ok) throw new Error(`day schedule unavailable: ${result.error}`)
      return result.day
    },
    staleTime: DayScheduleStaleMs,
  })
