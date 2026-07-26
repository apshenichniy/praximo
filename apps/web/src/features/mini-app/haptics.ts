import { loadTelegramWebApp } from "@/lib/telegram.ts"

/** Fire-and-forget Telegram haptic; a silent no-op outside Telegram. */
export const notifyHaptic = (type: "error" | "success" | "warning"): void => {
  void loadTelegramWebApp().then((webApp) => webApp?.HapticFeedback?.notificationOccurred(type))
}
