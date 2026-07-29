import type { FeedbackAdapter, FeedbackEvent } from "@praximo/ui"

import {
  isIosHost,
  loadTelegramWebApp,
  openExternalLink,
  openTelegramLink,
  readTelegramInitData,
  revealTelegramWebApp,
  shareInviteMessage,
  shareViaSystem,
  TELEGRAM_WEBAPP_SRC,
  type ShareInviteOptions,
  type ShareInviteOutcome,
  type SystemShareOutcome,
} from "./telegram/bridge.ts"
import { impactHaptic, notifyHaptic, selectionHaptic, useOpenHaptic } from "./telegram/haptics.ts"

export { HostBackButton } from "./telegram/telegram-back-button.tsx"
export { HostFullscreen } from "./telegram/telegram-fullscreen.tsx"
export { HostMainButton } from "./telegram/telegram-main-button.tsx"
export { HostTheme } from "./telegram/telegram-theme.tsx"
export {
  impactHaptic,
  isIosHost,
  notifyHaptic,
  openExternalLink,
  openTelegramLink,
  selectionHaptic,
  shareViaSystem,
  TELEGRAM_WEBAPP_SRC,
  useOpenHaptic,
}
export type { ShareInviteOutcome, SystemShareOutcome }

export async function readPresentationInitData(): Promise<string | undefined> {
  const webApp = await loadTelegramWebApp()
  if (webApp) revealTelegramWebApp(webApp)
  return readTelegramInitData(webApp)
}

export async function sharePreparedMessage(
  options: ShareInviteOptions,
): Promise<ShareInviteOutcome | "no-host"> {
  const webApp = await loadTelegramWebApp()
  return webApp === undefined ? "no-host" : shareInviteMessage(webApp, options)
}

const emitTelegramFeedback = (event: FeedbackEvent): void => {
  switch (event) {
    case "selection":
      selectionHaptic()
      return
    case "impact-light":
      impactHaptic("light")
      return
    case "impact-medium":
      impactHaptic("medium")
      return
    case "success":
      notifyHaptic("success")
      return
    case "error":
      notifyHaptic("error")
  }
}

export const presentationFeedback: FeedbackAdapter = {
  emit: emitTelegramFeedback,
}
