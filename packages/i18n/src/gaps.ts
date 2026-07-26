import type { CoachLanguage } from "@praximo/domain"

/**
 * A leaf that exists in the reference catalogue and is blank in a translation.
 *
 * The types already make an *omitted* key impossible, so what this names is the
 * other half: a key that is present and empty — a translator's placeholder, a
 * bad merge, a string somebody blanked while editing (#130).
 */
export class MissingTranslation extends Error {
  readonly locale: CoachLanguage
  readonly path: string

  constructor(locale: CoachLanguage, path: string, where: string) {
    super(
      `Missing ${locale} translation for "${path}". Add it to the ${locale} catalogue in ${where} — ` +
        `production would silently fall back to the reference language here, which is how a language ` +
        `ends up shipped and unread (#130).`,
    )
    this.name = "MissingTranslation"
    this.locale = locale
    this.path = path
  }
}

export interface FillGapsOptions {
  /**
   * Throw {@link MissingTranslation} on a blank leaf instead of substituting the
   * reference one.
   *
   * An explicit flag rather than a build-time global on purpose. `import.meta.env.DEV`
   * is a Vite construct: it exists in `apps/web`, and reading it inside a Worker
   * bundled by wrangler is a runtime crash. Each consumer says what it wants.
   */
  readonly strict: boolean
  /** Named in the failure message, so it points at the file to edit. */
  readonly where: string
  /** Leaf path accumulated by the walk; callers start at the root. */
  readonly path?: string
}

const isPresent = (value: unknown): boolean =>
  typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null

/**
 * Fill one catalogue out against the reference, leaf by leaf.
 *
 * Under `strict` a blank throws where it happens; otherwise it renders the
 * reference language, because a coach reading one English sentence in a
 * Ukrainian screen is a smaller failure than a coach reading `terms.points.3`.
 *
 * A function-valued leaf — the bot catalogue interpolates a bot username through
 * one — is present by definition and passes through untouched. What a function
 * *returns* is beyond this walk's reach; the catalogue's own parity tests cover
 * that half.
 */
export const fillGaps = <T>(
  reference: T,
  translation: T,
  locale: CoachLanguage,
  options: FillGapsOptions,
): T => {
  const path = options.path ?? ""
  const at = (key: string | number): FillGapsOptions => ({
    ...options,
    path: path === "" ? String(key) : `${path}.${key}`,
  })

  if (Array.isArray(reference)) {
    const translated = translation as ReadonlyArray<unknown>
    return reference.map((item, index) => fillGaps(item, translated[index], locale, at(index))) as T
  }
  if (typeof reference === "object" && reference !== null) {
    const source = translation as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(reference).map(([key, value]) => [
        key,
        fillGaps(value, source?.[key], locale, at(key)),
      ]),
    ) as T
  }
  if (isPresent(translation)) return translation
  if (options.strict) throw new MissingTranslation(locale, path, options.where)
  return reference
}

export interface CatalogueConfig<T> {
  /**
   * The language every other catalogue is filled out against, and the value a
   * gap falls back to.
   */
  readonly reference: CoachLanguage
  readonly byLocale: Record<CoachLanguage, T>
  readonly strict: boolean
  /** The file a `MissingTranslation` should send the reader to. */
  readonly where: string
}

/**
 * A catalogue's words in one language, resolved once per locale per process.
 *
 * The catalogues are constants, so the fallback walk cannot produce a different
 * answer the second time — and a Worker that renders the same locale on every
 * request must not pay for the walk on every request either.
 */
export const makeCatalogue = <T>(config: CatalogueConfig<T>): ((locale: CoachLanguage) => T) => {
  const resolved = new Map<CoachLanguage, T>()

  return (locale) => {
    const cached = resolved.get(locale)
    if (cached !== undefined) return cached
    const copy =
      locale === config.reference
        ? config.byLocale[config.reference]
        : fillGaps(config.byLocale[config.reference], config.byLocale[locale], locale, {
            strict: config.strict,
            where: config.where,
          })
    resolved.set(locale, copy)
    return copy
  }
}
