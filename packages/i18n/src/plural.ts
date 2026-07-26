import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "./locale-tag.ts"

/**
 * The count placeholder. A number is the one thing that may sit inside a
 * sentence rather than beside it: unlike a name or a username, it is the same
 * token in all three languages, and splitting «6 днів лишилося» into a lead and
 * a tail would put the plural form in the lead and the noun it agrees with in
 * the tail — two fields that can never be edited independently.
 */
const CountPlaceholder = "{count}"

/**
 * One field of a catalogue, in every plural form its language distinguishes.
 *
 * `other` is required because every CLDR language has it and it is what an
 * unlisted category falls back to. The rest are optional so an English field
 * stays two lines while a Ukrainian one is four.
 */
export interface PluralForms {
  readonly zero?: string
  readonly one?: string
  readonly two?: string
  readonly few?: string
  readonly many?: string
  readonly other: string
}

const rules = new Map<CoachLanguage, Intl.PluralRules>()

const rulesFor = (locale: CoachLanguage): Intl.PluralRules => {
  const cached = rules.get(locale)
  if (cached !== undefined) return cached
  const created = new Intl.PluralRules(localeTag(locale))
  rules.set(locale, created)
  return created
}

/**
 * The form of `forms` that `count` takes in `locale`, with `{count}` filled in.
 *
 * `en` distinguishes two forms and `uk` / `ru` three, which is the whole reason
 * this exists: 1 / 2 / 5 / 21 items are «1 сесія», «2 сесії», «5 сесій»,
 * «21 сесія» — the last one back to the singular form, which is exactly the
 * mistake hand-written pluralisation makes.
 */
export const plural = (locale: CoachLanguage, count: number, forms: PluralForms): string => {
  const category = rulesFor(locale).select(count)
  const form = forms[category] ?? forms.other
  return form.replaceAll(CountPlaceholder, String(count))
}
