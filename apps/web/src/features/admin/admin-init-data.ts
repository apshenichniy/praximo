import { notFound } from "@tanstack/react-router"
import { loadDevelopmentAdminInitData } from "@/server/admin-workspaces.functions.ts"
import { loadTelegramWebApp, readTelegramInitData } from "@/lib/telegram.ts"

export const resolveAdminInitData = async (): Promise<string> => {
  const webApp = await loadTelegramWebApp()
  webApp?.ready()
  webApp?.expand()

  const initData = readTelegramInitData(webApp)
  if (initData) return initData

  if (import.meta.env.DEV) {
    return loadDevelopmentAdminInitData()
  }

  throw notFound()
}
