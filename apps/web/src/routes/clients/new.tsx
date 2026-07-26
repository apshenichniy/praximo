import type { CoachLanguage } from "@praximo/domain"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"

import { EntryLoading } from "@/components/entry-loading.tsx"
import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import { NewClientScreen } from "@/features/coach/components/new-client-screen.tsx"
import { resolveLaunchCredential } from "@/features/entry/launch-credential.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { acceptOnce } from "@/routes/index.tsx"
import { createClient } from "@/server/coach-clients.functions.ts"
import { loadCoachEntry } from "@/server/coach.functions.ts"

/**
 * New client — a route rather than a state, because it is somewhere a coach
 * arrives from a list and leaves by going back, and the host's own back button
 * is what leaves it.
 *
 * The loader asks the entry rather than the client list: this screen needs the
 * coach's language and nothing else, and the entry is the one call every coach
 * surface already makes.
 */
export const Route = createFileRoute("/clients/new")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 200,
  pendingComponent: EntryLoading,
  loader: async () => {
    const [entry, credential] = await Promise.all([
      loadCoachEntry().catch(() => ({ ok: false, error: "server" }) as const),
      resolveLaunchCredential(),
    ])
    return { entry, launchLanguage: launchLocale(credential.initData) }
  },
  component: NewClientRoute,
})

function NewClientRoute() {
  const { entry, launchLanguage } = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const inFlight = useRef(false)

  const language = entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage
  const copy = coachCopy(language)

  const create = useCallback(
    (input: { readonly name: string; readonly inviteLanguage: CoachLanguage }) => {
      acceptOnce(inFlight, async () => {
        setPending(true)
        setError(undefined)
        try {
          const result = await createClient({ data: input })
          if (result.ok) {
            // Straight to the client's own route: there is no success screen,
            // and the screen they land on is the one they will come back to.
            await router.invalidate()
            await navigate({ to: "/clients/$clientId", params: { clientId: result.clientId } })
            return
          }
          setError(result.error === "invalid" ? copy.clients.nameRequired : copy.common.failed)
        } catch {
          setError(copy.common.failed)
        } finally {
          setPending(false)
        }
      })
    },
    [copy, navigate, router],
  )

  return (
    <MiniAppShell>
      <TelegramFullscreen />
      <NewClientScreen
        copy={copy}
        coachLanguage={language}
        onCreate={create}
        onBack={() => void navigate({ to: "/" })}
        pending={pending}
        error={error}
      />
    </MiniAppShell>
  )
}
