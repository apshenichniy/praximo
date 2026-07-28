/**
 * A minute-of-day as a coach reads it: `09:00`.
 *
 * One copy for the whole surface. Six files grew their own two-line version of
 * this while #210 was being built — the scheduling sheet, both hours screens,
 * the picker, the onboarding step and the summary line — and six copies of a
 * format is six chances for one of them to drift into `9:00` on a screen next
 * to one that says `09:00`.
 *
 * Deliberately not `Intl.DateTimeFormat`: this is a stored minute-of-day rather
 * than an instant, and every screen that shows it is already showing the
 * coach's own zone. A locale-aware formatter would introduce 12-hour clocks to
 * a product whose three languages all read 24.
 */
/** Two digits, so a column of times keeps one width. */
export const pad = (value: number): string => String(value).padStart(2, "0")

export const clock = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
