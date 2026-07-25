import { createFileRoute } from "@tanstack/react-router"

import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { privacyPolicyFor } from "@/features/legal/content.ts"
import { LegalPage } from "@/features/legal/components/legal-page.tsx"
import { PRIVACY_VERSION } from "@/features/legal/versions.ts"

/**
 * The privacy policy. Public and credential-free — the client who reads it from
 * the consent page has no account by design, and the coach who reaches it from
 * the terms screen has not accepted anything yet.
 */
export const Route = createFileRoute("/legal/privacy")({
  ssr: false,
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <MiniAppShell>
      <TelegramBackButton />
      <LegalPage document={privacyPolicyFor("en")} version={PRIVACY_VERSION} locale="en" />
    </MiniAppShell>
  )
}
