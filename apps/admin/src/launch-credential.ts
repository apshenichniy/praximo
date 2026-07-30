import { createLaunchCredentialMiddleware } from "@praximo/mini-app/launch-credential"
import { createLaunchCredentialResolver, readPresentationInitData } from "@/mini-app.tsx"
import { loadDevelopmentAdminInitData } from "@/server/development-admin-credential.ts"

export type { LaunchCredential } from "@praximo/mini-app"

export const resolveLaunchCredential = createLaunchCredentialResolver({
  isDevelopment: import.meta.env.DEV,
  readInitData: readPresentationInitData,
  loadDevelopmentInitData: import.meta.env.DEV ? () => loadDevelopmentAdminInitData() : undefined,
})

export const launchCredential = createLaunchCredentialMiddleware(resolveLaunchCredential)
