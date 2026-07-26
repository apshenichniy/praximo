import type { CoachLanguage } from "@praximo/domain"
import { enUS } from "react-day-picker/locale/en-US"
import { ru } from "react-day-picker/locale/ru"
import { uk } from "react-day-picker/locale/uk"
import type { DayPickerLocale } from "react-day-picker"

/**
 * Which locale the date picker formats and *speaks* in.
 *
 * `react-day-picker` wants a whole locale object, not a tag. Handing it
 * `{ code: "ru" }` — which is what the scheduling sheet did until this — leaves
 * every name at the date-fns default, so a fully Russian screen rendered «Su Mo
 * Tu We Th Fr Sa» and «July 2026» in the middle of itself.
 *
 * The objects come from **`react-day-picker/locale` rather than
 * `date-fns/locale`**: they are the same date-fns locales with the picker's own
 * labels translated on top — "Go to the next month", "Today, …, selected". Those
 * labels are what a screen reader reads out, and they are the half nobody
 * notices is still English.
 *
 * Imported one subpath at a time, never from the barrel: that module re-exports
 * about a hundred locales, and this app speaks three.
 *
 * **In `apps/web`, not in `@praximo/i18n`.** The shared package holds the i18n
 * mechanism both Workers need, and its own rule is that it depends on nothing
 * but the language literal (ADR 0002). A calendar locale is neither shared nor
 * mechanism: only this app renders a date picker, the bot has no calendar to
 * localise, and putting it there would add `date-fns` to a bundle that can never
 * use it. `localeTag` stays where it is — that one really is shared.
 */
const byLanguage: Record<CoachLanguage, DayPickerLocale> = { en: enUS, uk, ru }

export const calendarLocale = (language: CoachLanguage): DayPickerLocale => byLanguage[language]
