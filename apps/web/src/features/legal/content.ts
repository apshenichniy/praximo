import type { LegalDocument, LegalLocale } from "@/features/legal/document.ts"
import { coachTermsEn, privacyPolicyEn } from "@/features/legal/documents/en.ts"
import { coachTermsRu, privacyPolicyRu } from "@/features/legal/documents/ru.ts"
import { coachTermsUk, privacyPolicyUk } from "@/features/legal/documents/uk.ts"

export {
  b,
  LEGAL_PATHS,
  type LegalBlock,
  type LegalDocument,
  type LegalInline,
  type LegalLocale,
  type LegalPlaceholder,
  legalPlaceholders,
  type LegalSection,
  p,
  ph,
  ul,
} from "@/features/legal/document.ts"

/**
 * The two legal texts, as data, in the three languages the product speaks.
 *
 * They live in the app rather than on a marketing page (privacy-retention.md):
 * a coach reading the terms is inside a Mini App, and a link that ejects them
 * into a browser mid-onboarding is a link they may not come back from.
 *
 * All three locales are authored (#130). The English text remains the reference
 * the other two are translations of — `versions.ts` derives one version from it,
 * and `versions.test.ts` holds the three structurally identical, which is what
 * makes that single version an honest identifier of what a coach read in any of
 * them.
 */
const terms: Record<LegalLocale, LegalDocument> = {
  en: coachTermsEn,
  uk: coachTermsUk,
  ru: coachTermsRu,
}

const privacy: Record<LegalLocale, LegalDocument> = {
  en: privacyPolicyEn,
  uk: privacyPolicyUk,
  ru: privacyPolicyRu,
}

export const coachTermsFor = (locale: LegalLocale): LegalDocument => terms[locale]

export const privacyPolicyFor = (locale: LegalLocale): LegalDocument => privacy[locale]
