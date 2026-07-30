import { describe, expect, it } from "vitest"
import { schedulingCopy } from "@/__tests__/scheduling-copy.ts"
import { dayView } from "./day-view.ts"

describe("dayView", () => {
  it.each([
    {
      name: "shows a day off as one reveal rather than as working groups",
      schedule: { busy: [], timezone: "UTC" },
      durationMinutes: 60,
      expected: {
        dayOff: true,
        anyFree: true,
        groups: [],
        earlierHeading: "Not a working day",
        laterHeading: undefined,
      },
    },
    {
      name: "keeps an empty working group but gives the day an exit",
      schedule: {
        busy: [{ startMinutes: 6 * 60, endMinutes: 23 * 60 }],
        working: { startMinutes: 9 * 60, endMinutes: 10 * 60 },
        timezone: "UTC",
      },
      durationMinutes: 60,
      expected: {
        dayOff: false,
        anyFree: false,
        groups: [{ heading: "Morning", freeCount: 0, starts: [9 * 60] }],
        earlierHeading: "Earlier · from 06:00",
        laterHeading: "Later · until 23:00",
      },
    },
    {
      name: "cuts starts before the first minute still worth offering",
      schedule: {
        busy: [],
        earliestStartMinutes: 10 * 60 + 15,
        working: { startMinutes: 9 * 60, endMinutes: 12 * 60 },
        timezone: "UTC",
      },
      durationMinutes: 30,
      expected: {
        dayOff: false,
        anyFree: true,
        groups: [
          {
            heading: "Morning",
            freeCount: 6,
            starts: [615, 630, 645, 660, 675, 690],
          },
        ],
        earlierHeading: undefined,
        laterHeading: "Later · until 23:00",
      },
    },
    {
      name: "groups the working grid by part of day and counts only free starts",
      schedule: {
        busy: [{ startMinutes: 12 * 60, endMinutes: 12 * 60 + 30 }],
        working: { startMinutes: 11 * 60 + 30, endMinutes: 17 * 60 + 30 },
        timezone: "UTC",
      },
      durationMinutes: 30,
      expected: {
        dayOff: false,
        anyFree: true,
        groups: [
          { heading: "Morning", freeCount: 1, starts: [690, 705] },
          {
            heading: "Afternoon",
            freeCount: 18,
            starts: [
              720, 735, 750, 765, 780, 795, 810, 825, 840, 855, 870, 885, 900, 915, 930, 945, 960,
              975, 990, 1005,
            ],
          },
          { heading: "Evening", freeCount: 1, starts: [1020] },
        ],
        earlierHeading: "Earlier · from 06:00",
        laterHeading: "Later · until 23:00",
      },
    },
  ])("$name", ({ schedule, durationMinutes, expected }) => {
    const view = dayView({
      schedule,
      durationMinutes,
      date: new Date(2026, 6, 27),
      startMinutes: undefined,
      language: "en",
      copy: schedulingCopy,
    })

    expect(view.dayOff).toBe(expected.dayOff)
    expect(view.anyFree).toBe(expected.anyFree)
    expect(
      view.groups.map((group) => ({
        heading: group.heading,
        freeCount: group.freeCount,
        starts: group.slots.map((slot) => slot.startMinutes),
      })),
    ).toEqual(expected.groups)
    expect(view.earlier?.heading).toBe(expected.earlierHeading)
    expect(view.later?.heading).toBe(expected.laterHeading)
  })

  it.each([
    ["the selected session date", 9 * 60, "UTC+3"],
    ["no selected start yet", undefined, "UTC+3"],
  ] as const)("reads the offset for %s", (_name, startMinutes, expected) => {
    const view = dayView({
      schedule: {
        busy: [],
        working: { startMinutes: 9 * 60, endMinutes: 18 * 60 },
        timezone: "Europe/Kyiv",
      },
      durationMinutes: 60,
      date: new Date(2026, 6, 27),
      startMinutes,
      language: "en",
      copy: schedulingCopy,
    })

    expect(view.offsetLabel).toBe(expected)
  })
})
