import { createFileRoute } from "@tanstack/react-router"

import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { TERMS_VERSION, coachTermsFor } from "@praximo/i18n"
import { LegalPage } from "@/features/legal/components/legal-page.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { validateLegalSearch } from "@/features/legal/legal-search.ts"

/**
 * The coach terms, on an app route rather than a marketing page: the coach
 * reading them is inside a Mini App, and a link that ejects them into a browser
 * mid-onboarding is one they may not come back from (privacy-retention.md).
 * Public — nobody is signed in while deciding whether to sign in.
 */
export const Route = createFileRoute("/legal/terms")({
  ssr: false,
  validateSearch: validateLegalSearch,
  component: TermsPage,
})

function TermsPage() {
  const { lang } = Route.useSearch()
  return (
    <MiniAppShell>
      <TelegramBackButton label={coachCopy(lang).common.back} />
      <LegalPage document={coachTermsFor(lang)} version={TERMS_VERSION} locale={lang} />
    </MiniAppShell>
  )
}
