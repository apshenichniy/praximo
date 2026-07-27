import { TERMS_VERSION, coachTermsFor } from "@praximo/i18n"
import { createFileRoute } from "@tanstack/react-router"

import { ClientShell } from "@/components/client-shell.tsx"
import { LegalPage } from "@/features/legal/components/legal-page.tsx"
import { validateLegalSearch } from "@/features/legal/legal-search.ts"

/**
 * The coach terms. Public — nobody is signed in while deciding whether to sign
 * in — and reached from the Mini App's onboarding summary, which opens it in
 * Telegram's in-app browser so the coach keeps a way back (#191).
 *
 * It is the coach's document on the client app's host, which reads odd until you
 * notice what the alternative was: two copies of a contract whose version is
 * recorded against a person. The text lives in `@praximo/i18n` for that reason,
 * and the page that renders it belongs wherever the browser is.
 */
export const Route = createFileRoute("/legal/terms")({
  validateSearch: validateLegalSearch,
  component: TermsPage,
})

function TermsPage() {
  const { lang } = Route.useSearch()
  return (
    <ClientShell locale={lang}>
      <LegalPage document={coachTermsFor(lang)} version={TERMS_VERSION} locale={lang} />
    </ClientShell>
  )
}
