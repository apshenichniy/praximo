import type { CoachLanguage } from "@praximo/domain"

/**
 * The BCP-47 tag `Intl` is given for one of the product's three languages.
 *
 * `en` maps to `en-GB` rather than to `en`: the product's English is British —
 * day-first dates and a 24-hour clock — which is what the admin surface has
 * shipped since it existed, and what a coach in Kyiv or Warsaw reading the
 * English UI expects. `uk` and `ru` need no region: their date order and clock
 * are the same in every region that speaks them.
 */
export const localeTag = (locale: CoachLanguage): string => (locale === "en" ? "en-GB" : locale)
