// Admin copy is English-only (admin-surface.md), so formatters are pinned to
// English locales instead of following the device locale.

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

const absoluteFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export const formatTimestamp = (value: string | undefined, empty: string): string =>
  value === undefined ? empty : absoluteFormat.format(new Date(value))

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

const relativeSteps: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
]

/** "2 days ago" — falls back to "just now" under a minute. */
export const formatRelativeTime = (value: string): string => {
  const seconds = (Date.now() - new Date(value).getTime()) / 1000
  for (const [unit, size] of relativeSteps) {
    if (Math.abs(seconds) >= size) {
      return relativeFormat.format(Math.round(-seconds / size), unit)
    }
  }
  return "just now"
}

export const statusLabel = {
  "awaiting-setup": "Awaiting setup",
  connected: "Connected",
  "needs-relink": "Needs re-link",
} as const

export type BotStatus = keyof typeof statusLabel

export const languageLabel = {
  en: "English",
  uk: "Українська",
  ru: "Русский",
} as const

export const coachLanguages = [
  { value: "en", label: "English" },
  { value: "uk", label: "Українська" },
  { value: "ru", label: "Русский" },
] as const
