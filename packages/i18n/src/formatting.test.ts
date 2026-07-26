import { describe, expect, it } from "vitest"
import { formatters } from "./formatting.ts"
import { localeTag } from "./locale-tag.ts"

const Moment = new Date("2026-07-26T14:30:00.000Z")

describe("localeTag", () => {
  it("means British English, and plain tags for the rest", () => {
    expect(localeTag("en")).toBe("en-GB")
    expect(localeTag("uk")).toBe("uk")
    expect(localeTag("ru")).toBe("ru")
  })
})

describe("formatters", () => {
  it("builds one set per locale and reuses it", () => {
    expect(formatters("uk")).toBe(formatters("uk"))
    expect(formatters("uk")).not.toBe(formatters("ru"))
  })

  it("writes a day-first date with a 24-hour clock in English", () => {
    // The admin surface has shipped this shape since it existed; `en-GB` is what
    // keeps it identical now that the locale is a parameter. The connector
    // between date and time is deliberately not pinned — ICU spells it ", " or
    // " at " depending on its version, and that is not this package's contract.
    expect(formatters("en").timestamp(Moment)).toMatch(/^26 Jul 2026\D+\d{2}:\d{2}$/)
    expect(formatters("en").date(Moment)).toBe("26 Jul 2026")
  })

  it("writes the same moment in the reader's own language", () => {
    expect(formatters("uk").date(Moment)).not.toBe(formatters("en").date(Moment))
    expect(formatters("ru").date(Moment)).not.toBe(formatters("en").date(Moment))
  })

  it("names the largest unit that fits, past and future", () => {
    const now = new Date("2026-07-26T14:30:00.000Z")
    const relative = formatters("en").relative

    expect(relative(new Date("2026-07-24T14:30:00.000Z"), now)).toBe("2 days ago")
    expect(relative(new Date("2026-07-26T11:30:00.000Z"), now)).toBe("3 hours ago")
    expect(relative(new Date("2026-07-26T15:30:00.000Z"), now)).toBe("in 1 hour")
  })

  /**
   * The word for "just now" is copy, and copy belongs to a catalogue. A formatter
   * that invented one would put an English string inside a shared package and
   * hand every non-English surface a sentence it never wrote.
   */
  it("declines to answer under a minute", () => {
    const now = new Date("2026-07-26T14:30:00.000Z")

    expect(formatters("en").relative(new Date("2026-07-26T14:29:30.000Z"), now)).toBeUndefined()
  })
})
