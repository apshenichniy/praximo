import type { SchedulingCopy } from "@/features/coach/day-view.ts"

export const schedulingCopy: SchedulingCopy = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  earlierHeading: (from) => `Earlier · from ${from}`,
  laterHeading: (until) => `Later · until ${until}`,
  dayOffHeading: "Not a working day",
}
