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

const MinuteMs = 60 * 1_000
const HourMs = 60 * MinuteMs
const DayMs = 24 * HourMs

/**
 * The pending-invite countdown — "expires in 6d" / "expires in 5h". Days while
 * more than a day remains, hours below that, and a plain "expires today" in the
 * last hour, where a minute count would read as false precision. Only ever
 * shown for a `pending` invite: an accepted claim has no expiry (#112).
 */
export const formatExpiresIn = (value: string): string => {
  const remaining = new Date(value).getTime() - Date.now()
  if (remaining <= 0) return "expired"
  if (remaining >= DayMs) return `expires in ${Math.floor(remaining / DayMs)}d`
  if (remaining >= HourMs) return `expires in ${Math.floor(remaining / HourMs)}h`
  return "expires today"
}

export const channelLabel = {
  telegram: "Telegram",
  email: "email",
  copy: "a copied link",
} as const

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

/** The one language list, as options — invite-language chips derive from it. */
export const languageOptions = Object.entries(languageLabel).map(([value, label]) => ({
  value: value as keyof typeof languageLabel,
  label,
}))

/** An invite-first workspace may have no label yet; every display site falls back. */
export const displayName = (name: string): string => (name.length === 0 ? "Unnamed invite" : name)
