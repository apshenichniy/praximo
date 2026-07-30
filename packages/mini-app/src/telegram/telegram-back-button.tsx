import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useCallback, useEffect, useState } from "react"
import { backAction } from "../back-navigation.ts"
import { useHostNavigation } from "../navigation.tsx"
import { attachBackButton, loadTelegramWebApp, readTelegramInitData } from "./bridge.ts"

export function HostBackButton({
  onBack,
  label = "Back",
  fallbackTo = "/",
}: {
  readonly onBack?: () => void
  readonly label?: string
  /**
   * Where back goes when there is nowhere to go back *to*.
   *
   * A Mini App opened from a bot message lands directly on the screen the link
   * names — a client's card, a session — with an empty history, and `back()`
   * then does nothing whatsoever: a coach who arrived from the "client accepted"
   * notification could not leave the card without killing the app. So each
   * screen names its own parent, and back means "up" rather than "nowhere".
   */
  readonly fallbackTo?: string
} = {}) {
  const navigation = useHostNavigation()
  const [usesNativeButton, setUsesNativeButton] = useState<boolean>()
  const handleBack = useCallback(() => {
    if (onBack !== undefined) {
      onBack()
      return
    }
    const action = backAction({
      canGoBack: navigation.canGoBack(),
      fallbackTo: fallbackTo ?? "/",
    })
    if (action.kind === "history") navigation.back()
    // Replaced, never pushed: pushing the parent leaves the screen the deep link
    // opened sitting *behind* it, and back walks straight back down into it.
    else navigation.replace(action.to)
  }, [fallbackTo, navigation, onBack])

  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | undefined

    void loadTelegramWebApp().then((webApp) => {
      if (cancelled) return
      const isTelegramLaunch = Boolean(readTelegramInitData(webApp))
      setUsesNativeButton(isTelegramLaunch)
      if (webApp && isTelegramLaunch) {
        detach = attachBackButton(webApp, handleBack)
      }
    })

    return () => {
      cancelled = true
      detach?.()
    }
  }, [handleBack])

  if (usesNativeButton !== false) return null

  return (
    <button
      type="button"
      onClick={handleBack}
      className="text-muted-foreground hover:text-foreground -ml-2 inline-flex h-10 items-center gap-2 rounded-xl px-2 text-base leading-relaxed transition-colors"
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} size={20} strokeWidth={2} />
      {label}
    </button>
  )
}
