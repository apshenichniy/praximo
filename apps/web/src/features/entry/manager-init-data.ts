import { loadDevelopmentAdminInitData } from "@/server/admin-workspaces.functions.ts"
import { loadTelegramWebApp, readTelegramInitData, revealTelegramWebApp } from "@/lib/telegram.ts"

/**
 * The manager Mini App's launch credential, read once at the entry (#106).
 *
 * An absent credential is an answer, not a failure: outside a Telegram host
 * there is nobody to identify, and the entry renders the invite-only landing
 * rather than a missing page. The empty string carries that — every consumer
 * treats it as "unauthenticated", and it keeps the credential a plain `string`
 * for the admin screens downstream, which only ever run with a real one.
 */
export const resolveManagerInitData = async (): Promise<string> => {
  const webApp = await loadTelegramWebApp()
  if (webApp) revealTelegramWebApp(webApp)

  const initData = readTelegramInitData(webApp)
  if (initData) return initData

  // Local Vite only: a short-lived signed credential for the seeded admin, so
  // the real HMAC and DB gates run in development instead of being stubbed out.
  if (import.meta.env.DEV) {
    return loadDevelopmentAdminInitData().catch(() => "")
  }

  return ""
}
