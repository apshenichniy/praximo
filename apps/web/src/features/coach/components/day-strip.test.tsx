import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { DayStrip } from "@/features/coach/components/day-strip.tsx"
import { addDays } from "@/features/coach/day-strip.ts"

/**
 * The strip's shape, asserted because it is load-bearing and invisible to the
 * typechecker.
 *
 * Every day is a fixed-width column — that is what keeps the field's height
 * constant, which is the whole reason the strip replaced the folding month
 * (#186). A single mangled class name turned the days into a row of squashed
 * pills, and nothing but a pair of eyes caught it.
 */
const TODAY = new Date("2026-08-10T09:00:00")
const DAYS = [TODAY, addDays(TODAY, 1), addDays(TODAY, 2)]

const markup = (selected: Date, booked: ReadonlyArray<Date> = []): string =>
  renderToStaticMarkup(
    <DayStrip
      days={DAYS}
      selected={selected}
      today={TODAY}
      isBooked={(day) => booked.some((other) => other.getDate() === day.getDate())}
      language="ru"
      monthLabel="Месяц"
      onPick={() => {}}
      onExtend={() => {}}
      onOpenMonth={() => {}}
      onVisibleMonth={() => {}}
      centreRequest={0}
    />,
  )

describe("DayStrip", () => {
  it("lays every day out as a fixed-width column", () => {
    const html = markup(TODAY)
    const days = [...html.matchAll(/class="([^"]*)"/g)]
      .map(([, value]) => value ?? "")
      .filter((value) => value.includes("w-14"))

    expect(days).toHaveLength(DAYS.length + 1) // the days, plus the month control
    for (const value of days) {
      expect(value.split(/\s+/)).toContain("flex-none")
      expect(value.split(/\s+/)).toContain("flex-col")
    }
  })

  it("marks the chosen day and nothing else", () => {
    const html = markup(DAYS[1] as Date)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2)
  })

  it("names the days in the coach's language and ends in the month", () => {
    const html = markup(TODAY)
    expect(html).toContain("пн")
    expect(html).toContain("10")
    expect(html).toContain("Месяц")
  })

  it("dots a day the client already has a session on", () => {
    const withDot = markup(TODAY, [DAYS[2] as Date])
    expect(withDot.match(/size-1 rounded-full bg-primary/g)).toHaveLength(1)
    expect(markup(TODAY).match(/size-1 rounded-full bg-primary/g)).toBeNull()
  })
})
