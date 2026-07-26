import type { QueryClient } from "@tanstack/react-query"
import { queryOptions } from "@tanstack/react-query"

import type { DayScheduleData } from "@/features/coach/components/scheduling-screen.tsx"
import { shiftDate } from "@/lib/coach-calendar.ts"
import { getDaySchedule, getRangeSchedule } from "@/server/coach-clients.functions.ts"

/**
 * The days the scheduling screen draws, cached (#186).
 *
 * The screen used to read a day straight from a `useEffect`, so a coach
 * comparing Tuesday against Wednesday paid a round-trip and a skeleton for every
 * glance — including the trip back to a day they had just looked at.
 *
 * A day is *not* immutable: a session can be booked from the bot, from another
 * device, or by this screen a moment ago. So the cache is short-lived and
 * cleared outright once a booking lands — a stale free slot is the one thing
 * this screen must never show, because the coach would then be offered a start
 * the server has already refused.
 */
export const dayScheduleKeys = {
  all: ["coach", "day-schedule"] as const,
  day: (date: string) => [...dayScheduleKeys.all, "day", date] as const,
  range: (from: string, days: number) => [...dayScheduleKeys.all, "range", from, days] as const,
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

/**
 * The whole strip in one read.
 *
 * A day is a handful of `{start, end}` pairs — a fortnight of them is a couple
 * of kilobytes — so what a day-at-a-time strip costs is not bytes but fourteen
 * round-trips and fourteen queries. This asks once for the window the coach can
 * see, and the answer is filed per day so the days' own queries find it already
 * there.
 *
 * A query in its own right rather than a bare fetch, because that is what makes
 * two screens asking at once, and a strip that re-reports the same window, one
 * request instead of several.
 */
const rangeSchedule = (from: string, days: number) =>
  queryOptions({
    queryKey: dayScheduleKeys.range(from, days),
    queryFn: async () => {
      const result = await getRangeSchedule({ data: { from, days } })
      if (!result.ok) throw new Error(`range schedule unavailable: ${result.error}`)
      return result.days
    },
    staleTime: DayScheduleStaleMs,
  })

/**
 * Read a window and file every day of it under its own key.
 *
 * Nothing happens when the window is already in hand and fresh: the strip
 * reports its window whenever it grows, and re-reading a fortnight because a
 * coach scrolled would undo the point of asking for it in one go.
 */
export const primeDayRange = async (
  client: QueryClient,
  from: string,
  days: number,
): Promise<void> => {
  const cached = Array.from({ length: days }, (_, index) => index).every((index) => {
    const state = client.getQueryState<DayScheduleData>(dayScheduleKeys.day(shiftDate(from, index)))
    return state?.data !== undefined && Date.now() - state.dataUpdatedAt < DayScheduleStaleMs
  })
  if (cached) return

  const window = await client.fetchQuery(rangeSchedule(from, days))
  for (const day of window) {
    client.setQueryData<DayScheduleData>(dayScheduleKeys.day(day.date), {
      busy: day.busy,
      ...(day.earliestStartMinutes === undefined
        ? {}
        : { earliestStartMinutes: day.earliestStartMinutes }),
      timezone: day.timezone,
    })
  }
}
