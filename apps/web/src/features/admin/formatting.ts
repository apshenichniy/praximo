import { formatters } from "@praximo/i18n"

import type { TimestampFormat } from "@/features/mini-app/timestamp-format.tsx"

// Admin copy is English-only (admin-surface.md), so this surface pins the shared
// locale formatters to English instead of following the device or the member.
// The formatters themselves became a parameter of the language in #167 — what
// stays here is the choice of language, and the English words around them.
const english = formatters("en")

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

export const formatTimestamp = (value: string | undefined, empty: string): string =>
  value === undefined ? empty : english.timestamp(value)

/** The day alone, for a value whose time of day carries no meaning. */
export const formatDate = (value: string | undefined, empty: string): string =>
  value === undefined ? empty : english.date(value)

/**
 * "2 days ago" — falls back to "just now" under a minute.
 *
 * The shared formatter declines to answer below a minute rather than inventing a
 * word for it: "just now" is copy, and this surface's copy is English.
 */
export const formatRelativeTime = (value: string): string => english.relative(value) ?? "just now"

/**
 * What `TimestampValue` writes on an admin screen. One value, provided once at
 * the top of the details route, rather than a prop threaded through seven call
 * sites.
 */
export const adminTimestampFormat: TimestampFormat = {
  relative: formatRelativeTime,
  absolute: (value) => formatTimestamp(value, ""),
}

const MinuteMs = 60 * 1_000
const HourMs = 60 * MinuteMs
const DayMs = 24 * HourMs

/**
 * The pending-invite countdown — "expires in 6d" / "expires in 5h". Days while
 * more than a day remains, hours below that, and a plain "expires today" in the
 * last hour, where a minute count would read as false precision. Only ever
 * shown for a `pending` invite: an accepted claim has no expiry (#112).
 *
 * English sentences rather than formatting, so this stays admin's own and does
 * not move to `@praximo/i18n` (#167). The coach surface's countdown is its own
 * copy, in the coach's language.
 */
export const formatExpiresIn = (value: string): string => {
  const remaining = new Date(value).getTime() - Date.now()
  if (remaining <= 0) return "expired"
  if (remaining >= DayMs) return `expires in ${Math.floor(remaining / DayMs)}d`
  if (remaining >= HourMs) return `expires in ${Math.floor(remaining / HourMs)}h`
  return "expires today"
}

/** The delivery channel as a standalone value — a table cell, not a sentence. */
export const channelLabel = {
  telegram: "Telegram",
  email: "Email",
  copy: "Copied link",
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
