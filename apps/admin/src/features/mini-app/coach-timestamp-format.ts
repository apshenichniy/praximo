import type { CoachLanguage } from "@praximo/domain"
import { formatters } from "@praximo/i18n"

import type { TimestampFormat } from "@/features/mini-app/timestamp-format.tsx"

/**
 * How the coach's screens write a moment, in `member.language`.
 *
 * The shared formatter returns `undefined` under a minute rather than a word
 * for "just now" — that word is copy, and copy belongs to a catalogue. This is
 * where the coach surface supplies its own, so the primitive never has to know
 * which language it is in.
 */
export const coachTimestampFormat = (locale: CoachLanguage): TimestampFormat => {
  const format = formatters(locale)
  const justNow = { en: "just now", uk: "щойно", ru: "только что" }[locale]
  return {
    relative: (value) => format.relative(value) ?? justNow,
    absolute: (value) => format.timestamp(value),
  }
}
