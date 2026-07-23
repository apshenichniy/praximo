import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { attachBackButton, loadTelegramWebApp, readTelegramInitData } from "@/lib/telegram.ts"

export function TelegramBackButton() {
  const router = useRouter()
  const [usesNativeButton, setUsesNativeButton] = useState<boolean>()

  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | undefined

    void loadTelegramWebApp().then((webApp) => {
      if (cancelled) return
      const isTelegramLaunch = Boolean(readTelegramInitData(webApp))
      setUsesNativeButton(isTelegramLaunch)
      if (webApp && isTelegramLaunch) {
        detach = attachBackButton(webApp, () => router.history.back())
      }
    })

    return () => {
      cancelled = true
      detach?.()
    }
  }, [router])

  if (usesNativeButton !== false) return null

  return (
    <button
      type="button"
      onClick={() => router.history.back()}
      className="text-muted-foreground hover:text-foreground -ml-2 inline-flex h-10 items-center gap-2 rounded-xl px-2 text-sm transition-colors"
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} size={20} strokeWidth={2} />
      Back
    </button>
  )
}
