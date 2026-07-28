import type { CoachLanguage, WorkingHours } from "@praximo/domain"

import { summariseWorkingHours } from "@/features/coach/working-hours-summary.ts"
import type { AvailabilityCopy } from "@/features/i18n/coach-copy/availability.ts"
import { weekdayLabel } from "@/features/i18n/weekday-label.ts"

const pad = (value: number): string => String(value).padStart(2, "0")
const clock = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

/**
 * The coach's week as one line: «Mon–Fri 09:00–19:00 · 1 day set separately».
 *
 * Assembled from parts rather than templated, and joined only by punctuation and
 * a space — the days, the clock and the aside are three tokens that read in the
 * same order in all three languages, which a sentence about them would not.
 *
 * A dash is only used for days that genuinely run together; anything else is
 * listed, because «Mon–Fri» for a coach who works Monday, Wednesday and Friday
 * is the line stating a week they do not have.
 */
export const workingHoursLine = (
  hours: WorkingHours,
  copy: AvailabilityCopy,
  language: CoachLanguage,
): string => {
  const summary = summariseWorkingHours(hours)
  if (summary.noDays) return copy.noWorkingDays

  const first = summary.run[0]
  const last = summary.run.at(-1)
  const days = summary.everyDay
    ? copy.everyDay
    : summary.contiguous && first !== undefined && last !== undefined
      ? `${weekdayLabel(language, first)}–${weekdayLabel(language, last)}`
      : summary.run.map((weekday) => weekdayLabel(language, weekday)).join(", ")

  const window = `${clock(summary.window.startMinutes)}–${clock(summary.window.endMinutes)}`
  return `${days} ${window}${summary.ownHours > 0 ? copy.ownHours(summary.ownHours) : ""}`
}
