import type { CoachLanguage } from "@praximo/domain"

/**
 * The shape both legal texts are authored in, and the builders that keep the
 * three language files readable.
 *
 * Structured rather than authored as TSX because two things have to be
 * mechanical: the version is derived from this content, so filling a placeholder
 * necessarily changes it (see `versions.ts`), and the placeholder registry is
 * checked against what the text actually contains rather than against a list
 * somebody remembered to update. Since #130 a third thing rides on it — the
 * three locales are checked against each other structurally, which is what lets
 * one version identify a document a coach read in any of them.
 */
export type LegalLocale = CoachLanguage

/**
 * Everything still waiting on the legal-entity decision deferred in #6. Every
 * one of these appears in the texts, and a test holds the two in step: a marker
 * nobody registered would otherwise ship as a launch blocker nobody knew about.
 *
 * The markers themselves are English in every locale on purpose. They are notes
 * to us, not text for a reader, and translating them would multiply by three the
 * number of places the real values eventually have to land.
 */
export const legalPlaceholders = {
  operator: "operator legal name and address",
  llmProviders: "LLM providers",
  pricing: "pricing terms",
  liabilityCap: "liability cap",
  jurisdiction: "jurisdiction",
  contactEmail: "contact email",
} as const

export type LegalPlaceholder = keyof typeof legalPlaceholders

/** A run of text. Anything but a plain string is rendered differently. */
export type LegalInline =
  | string
  | { readonly emphasis: string }
  | { readonly placeholder: LegalPlaceholder }
  | { readonly link: string; readonly to: string }

export type LegalBlock =
  | { readonly kind: "paragraph"; readonly content: ReadonlyArray<LegalInline> }
  | { readonly kind: "list"; readonly items: ReadonlyArray<ReadonlyArray<LegalInline>> }
  | {
      readonly kind: "table"
      readonly head: ReadonlyArray<string>
      readonly rows: ReadonlyArray<ReadonlyArray<LegalInline>>
    }

export interface LegalSection {
  readonly heading: string
  readonly blocks: ReadonlyArray<LegalBlock>
}

export interface LegalDocument {
  readonly title: string
  readonly intro: ReadonlyArray<LegalBlock>
  readonly sections: ReadonlyArray<LegalSection>
}

/** Where each text lives. Exported so #39's client consent links the same URLs. */
export const LEGAL_PATHS = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
} as const

export const p = (...content: ReadonlyArray<LegalInline>): LegalBlock => ({
  kind: "paragraph",
  content,
})

export const ul = (...items: ReadonlyArray<ReadonlyArray<LegalInline>>): LegalBlock => ({
  kind: "list",
  items,
})

export const b = (emphasis: string): LegalInline => ({ emphasis })

export const ph = (placeholder: LegalPlaceholder): LegalInline => ({ placeholder })
