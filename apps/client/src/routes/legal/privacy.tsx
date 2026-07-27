import { PRIVACY_VERSION, privacyPolicyFor } from "@praximo/i18n"
import { createFileRoute } from "@tanstack/react-router"

import { ClientShell } from "@/components/client-shell.tsx"
import { LegalPage } from "@/features/legal/components/legal-page.tsx"
import { validateLegalSearch } from "@/features/legal/legal-search.ts"

/**
 * The privacy policy. Public and credential-free — the client who reads it from
 * the consent page has no account by design, and the coach who reaches it from
 * the terms screen has not accepted anything yet.
 *
 * Server-rendered, unlike the copy this replaced in `apps/web` (#191). That one
 * was `ssr: false` because it lived in an app whose every route waits for a
 * Telegram credential that arrives after load. Nothing here waits for anything:
 * the text is a constant and the language is in the URL, so the reader should be
 * handed the finished document rather than a blank page and a bundle.
 */
export const Route = createFileRoute("/legal/privacy")({
  validateSearch: validateLegalSearch,
  component: PrivacyPage,
})

function PrivacyPage() {
  const { lang } = Route.useSearch()
  return (
    <ClientShell locale={lang}>
      <LegalPage document={privacyPolicyFor(lang)} version={PRIVACY_VERSION} locale={lang} />
    </ClientShell>
  )
}
