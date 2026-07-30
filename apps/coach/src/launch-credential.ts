import { createLaunchCredentialMiddleware } from "@praximo/mini-app/launch-credential"
import { createLaunchCredentialResolver, readPresentationInitData } from "@/mini-app.tsx"
import { loadDevelopmentCoachInitData } from "@/server/development-coach-credential.ts"

export type { LaunchCredential } from "@praximo/mini-app"

const readBotId = (): string =>
  typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("b") ?? "")

export const resolveLaunchCredential = createLaunchCredentialResolver({
  isDevelopment: import.meta.env.DEV,
  readBotId,
  readInitData: readPresentationInitData,
  // A local browser needs the same `?b=<bot-id>` selector as the real Coach
  // Mini App; no selector means no development credential, never Admin identity.
  loadDevelopmentInitData: import.meta.env.DEV
    ? (botId) => loadDevelopmentCoachInitData({ data: { botId } })
    : undefined,
})

export const launchCredential = createLaunchCredentialMiddleware(resolveLaunchCredential)
