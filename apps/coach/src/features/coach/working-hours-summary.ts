import { type Weekday, Weekdays, type WorkingHours } from "@praximo/domain"

/**
 * The one line that says a coach's week back to them (#210).
 *
 * It is read in three places — the row on Today, the row on Availability, and
 * the foot of the hours screen — so it is computed once here rather than
 * assembled three times. The shape is data rather than a sentence: word order
 * differs between the three languages this ships in, and a string built here
 * would be a translation waiting to read backwards.
 */
export interface WorkingHoursSummary {
  /** The working days, run together: `["mon", "fri"]` for Monday to Friday. */
  readonly run: ReadonlyArray<Weekday>
  /** True when the run is contiguous and worth a dash rather than a list. */
  readonly contiguous: boolean
  readonly everyDay: boolean
  readonly noDays: boolean
  /** The shared window, as minutes-of-day. */
  readonly window: { readonly startMinutes: number; readonly endMinutes: number }
  /** How many days keep hours of their own — what the line has to admit to. */
  readonly ownHours: number
}

/**
 * Which days are worked, and whether they happen to be a run.
 *
 * A run is only claimed when the working days are *consecutive in week order*,
 * so «Mon–Fri» is never printed for a coach who works Monday, Wednesday and
 * Friday. Sunday closing a run that starts on Monday is the ordinary week, and
 * a week wrapping from Saturday into Monday is not treated as contiguous: it
 * reads as a range that runs backwards.
 */
export const summariseWorkingHours = (hours: WorkingHours): WorkingHoursSummary => {
  const worked = Weekdays.filter((weekday) => hours.days[weekday] !== "off")
  const ownHours = Weekdays.filter((weekday) => {
    const day = hours.days[weekday]
    return day !== "off" && day !== "window"
  }).length

  const indexes = worked.map((weekday) => Weekdays.indexOf(weekday))
  const contiguous =
    indexes.length > 1 && indexes.every((value, position) => value === (indexes[0] ?? 0) + position)

  return {
    run: worked,
    contiguous,
    everyDay: worked.length === Weekdays.length,
    noDays: worked.length === 0,
    window: hours.window,
    ownHours,
  }
}
