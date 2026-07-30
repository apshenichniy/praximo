import type { FeedbackAdapter, FeedbackEvent } from "@praximo/ui"

import {
  loadTelegramWebApp,
  readTelegramInitData,
  revealTelegramWebApp,
  shareInviteMessage,
  type ShareInviteOptions,
  type ShareInviteOutcome,
} from "./telegram/bridge.ts"
import { impactHaptic, notifyHaptic, selectionHaptic } from "./telegram/haptics.ts"

export * from "./back-navigation.ts"
export * from "./launch-credential-core.ts"
export * from "./motion.ts"
export * from "./navigation.tsx"
export * from "./telegram/haptics.ts"
export {
  applyMainButtonColors,
  applyTelegramSurfaceColors,
  attachBackButton,
  BOTTOM_BAR_COLOR_MIN_VERSION,
  claimMainButton,
  CUSTOM_HEADER_COLOR_MIN_VERSION,
  enterFullscreen,
  FULLSCREEN_MIN_VERSION,
  HAPTIC_MIN_VERSION,
  hostPlatform,
  IOS_PLATFORM,
  isIosHost,
  loadTelegramWebApp,
  MAIN_BUTTON_PARAMS_MIN_VERSION,
  openExternalLink,
  openTelegramLink,
  readTelegramInitData,
  revealTelegramWebApp,
  SHARE_MESSAGE_MIN_VERSION,
  shareInviteMessage,
  shareViaSystem,
  TELEGRAM_WEBAPP_SRC,
  VERTICAL_SWIPES_MIN_VERSION,
  watchTelegramColorScheme,
} from "./telegram/bridge.ts"
export type {
  HostBackButton as TelegramHostBackButton,
  HostMainButton as TelegramHostMainButton,
  ShareInviteOptions,
  ShareInviteOutcome,
  SystemShareOutcome,
  TelegramWebApp,
} from "./telegram/bridge.ts"
export { HostBackButton } from "./telegram/telegram-back-button.tsx"
export { HostFullscreen } from "./telegram/telegram-fullscreen.tsx"
export { HostMainButton } from "./telegram/telegram-main-button.tsx"
export { HostTheme } from "./telegram/telegram-theme.tsx"
export * from "./theme.ts"

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
