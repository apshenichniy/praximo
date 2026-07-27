import { type CoachLanguage, DefaultCoachLanguage } from "@praximo/domain"
import { makeCatalogue } from "@praximo/i18n"

/**
 * The words the page *frame* says — as distinct from the words the product says
 * to a client, which live in `@praximo/i18n`'s `clientCopy` because two Workers
 * say them.
 *
 * These have one reader, this app, so they are here: a catalogue is owned by the
 * surface that says it (ADR 0002). Only the mechanism is shared.
 *
 * Deliberately small. It grows with the surfaces that arrive — the acceptance
 * page (#57), the web room — and not before.
 */
export interface ChromeCopy {
  readonly theme: {
    /** The group's accessible name. Not rendered as a heading — the footer is a footer. */
    readonly label: string
    readonly system: string
    readonly light: string
    readonly dark: string
  }
}

const en: ChromeCopy = {
  theme: { label: "Appearance", system: "System", light: "Light", dark: "Dark" },
}

const uk: ChromeCopy = {
  theme: { label: "Вигляд", system: "Системний", light: "Світлий", dark: "Темний" },
}

const ru: ChromeCopy = {
  theme: { label: "Внешний вид", system: "Системный", light: "Светлый", dark: "Тёмный" },
}

/**
 * Not strict, for the same reason `clientCopy` is not: a reader who came to read
 * a contract must never meet a thrown `MissingTranslation` because a footer
 * label was missed. The parity test holds the three level instead.
 */
const resolve = makeCatalogue<ChromeCopy>({
  reference: DefaultCoachLanguage,
  byLocale: { en, uk, ru },
  strict: false,
  where: "apps/client/src/features/i18n/chrome-copy.ts",
})

export const chromeCopy = (locale: CoachLanguage): ChromeCopy => resolve(locale)
