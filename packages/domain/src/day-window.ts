/**
 * A stretch of one day, as minutes-of-day, and the grid those minutes sit on.
 *
 * Its own module because both halves of #210 need it and neither may own it:
 * `scheduling.ts` builds the sheet's grid from a window, `working-hours.ts`
 * stores the windows a coach chose, and a shared type between them is the only
 * thing standing between "the hours the coach set" and "the hours the sheet
 * offers" drifting apart.
 */

export const MinutesInDay = 24 * 60

/** The grid step. Coaches book on the hour and the half, but not only. */
export const SlotStepMinutes = 15

/** Minutes-of-day, half-open: a session may start at `start` and must end by `end`. */
export interface DayWindow {
  readonly startMinutes: number
  readonly endMinutes: number
}

const onGrid = (minutes: number): boolean =>
  Number.isInteger(minutes) && minutes % SlotStepMinutes === 0

/**
 * Whether a value is a window this product can act on.
 *
 * The grid check is the load-bearing one. A window starting at 09:07 would put
 * every start it generates off the fifteen-minute grid, and the server refuses
 * those — so an ungridded window is a screen offering what the server will not
 * take, which is the one direction the drift must never go.
 */
export const isDayWindow = (value: unknown): value is DayWindow => {
  if (typeof value !== "object" || value === null) return false
  const { startMinutes, endMinutes } = value as Record<string, unknown>
  return (
    typeof startMinutes === "number" &&
    typeof endMinutes === "number" &&
    onGrid(startMinutes) &&
    onGrid(endMinutes) &&
    startMinutes >= 0 &&
    endMinutes <= MinutesInDay &&
    startMinutes < endMinutes
  )
}
