import { createFileRoute } from "@tanstack/react-router"

import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { coachTermsFor } from "@/features/legal/content.ts"
import { LegalPage } from "@/features/legal/components/legal-page.tsx"
import { TERMS_VERSION } from "@/features/legal/versions.ts"

/**
 * The coach terms, on an app route rather than a marketing page: the coach
 * reading them is inside a Mini App, and a link that ejects them into a browser
 * mid-onboarding is one they may not come back from (privacy-retention.md).
 * Public — nobody is signed in while deciding whether to sign in.
 */
export const Route = createFileRoute("/legal/terms")({
  ssr: false,
  component: TermsPage,
})

function TermsPage() {
  return (
    <MiniAppShell>
      <TelegramBackButton />
      <LegalPage document={coachTermsFor("en")} version={TERMS_VERSION} locale="en" />
    </MiniAppShell>
  )
}
