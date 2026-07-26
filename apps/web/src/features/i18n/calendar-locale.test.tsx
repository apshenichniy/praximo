import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Calendar } from "@/components/ui/calendar.tsx"
import { calendarLocale } from "@/features/i18n/calendar-locale.ts"

/**
 * The defect this closes rendered «Su Mo Tu We Th Fr Sa» and «July 2026» in the
 * middle of an otherwise fully Russian screen, for a year, because
 * `locale={{ code: localeTag(language) }}` type-checks and does nothing:
 * `react-day-picker` wants a locale object, and a bare tag leaves every name at
 * the date-fns default.
 *
 * So the test renders the calendar rather than asserting on the map — a unit
 * test of the mapping would have passed throughout.
 */
const month = new Date("2026-07-15T12:00:00.000Z")

const render = (language: "en" | "uk" | "ru") =>
  renderToStaticMarkup(<Calendar mode="single" month={month} locale={calendarLocale(language)} />)

describe("the scheduling calendar's locale", () => {
  it("writes weekday and month names in the coach's language", () => {
    const russian = render("ru")
    expect(russian).toContain("июль")
    // Weekday headings are the ones the original defect left in English.
    expect(russian).toContain("вс")
    expect(russian).not.toContain("July")
    expect(russian).not.toContain("Su")

    const ukrainian = render("uk")
    expect(ukrainian).toContain("липень")
    expect(ukrainian).not.toContain("July")
  })

  it("still writes English for a coach who reads English", () => {
    const english = render("en")
    expect(english).toContain("July")
    expect(english).toContain("Su")
  })

  /**
   * The half nobody sees: `react-day-picker/locale` is the date-fns locale with
   * the picker's *own* labels translated on top, and those are what a screen
   * reader reads out. Taking the objects from `date-fns/locale` instead would
   * fix the visible names and leave every aria label in English.
   */
  it("carries the picker's own labels, not just the date-fns names", () => {
    for (const language of ["en", "uk", "ru"] as const) {
      expect(calendarLocale(language).labels, language).toBeDefined()
    }
    expect(calendarLocale("ru").labels?.labelPrevious).toBe("Перейти к предыдущему месяцу")
    expect(calendarLocale("uk").labels?.labelNext).toBeTruthy()
  })
})
