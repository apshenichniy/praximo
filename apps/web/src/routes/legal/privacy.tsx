import { createFileRoute } from "@tanstack/react-router"

import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { privacyPolicyFor } from "@/features/legal/content.ts"
import { LegalPage } from "@/features/legal/components/legal-page.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { validateLegalSearch } from "@/features/legal/legal-search.ts"
import { PRIVACY_VERSION } from "@/features/legal/versions.ts"

/**
 * The privacy policy. Public and credential-free — the client who reads it from
 * the consent page has no account by design, and the coach who reaches it from
 * the terms screen has not accepted anything yet.
 */
export const Route = createFileRoute("/legal/privacy")({
  ssr: false,
  validateSearch: validateLegalSearch,
  component: PrivacyPage,
})

function PrivacyPage() {
  const { lang } = Route.useSearch()
  return (
    <MiniAppShell>
      <TelegramBackButton label={coachCopy(lang).common.back} />
      <LegalPage document={privacyPolicyFor(lang)} version={PRIVACY_VERSION} locale={lang} />
    </MiniAppShell>
  )
}
