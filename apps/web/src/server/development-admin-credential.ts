import { createHmac } from "node:crypto"
import { notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"

/**
 * The manager-side twin of `development-coach-credential.ts`: local development
 * mints a real HMAC `initData` for the seeded admin and runs the real verifier
 * against it, so no authentication-bypass path exists (ADR 0006).
 *
 * It lives here rather than beside the admin transports because the client
 * credential module imports it, and those transports import the middleware that
 * module provides — an import cycle that leaves the middleware undefined at
 * evaluation time.
 */
const signDevelopmentInitData = (token: string, telegramId: string, authDate: number): string => {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "praximo-local-development",
    user: JSON.stringify({
      id: Number(telegramId),
      first_name: "Local",
      last_name: "Admin",
    }),
  })
  params.sort()

  const dataCheckString = [...params.entries()].map(([key, value]) => `${key}=${value}`).join("\n")
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest()
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex")
  params.set("hash", hash)

  return params.toString()
}

/**
 * Local Vite only: produce a short-lived credential so the real auth and DB
 * gate run without exposing the manager token to client JavaScript.
 */
export const loadDevelopmentAdminInitData = createServerFn({
  method: "POST",
}).handler(() => {
  if (!import.meta.env.DEV) throw notFound()

  const token = process.env.MANAGER_BOT_TOKEN
  const telegramId = process.env.ADMIN_TELEGRAM_IDS?.split(",")[0]?.trim()
  if (
    !token ||
    !telegramId ||
    !/^[1-9]\d*$/.test(telegramId) ||
    !Number.isSafeInteger(Number(telegramId))
  ) {
    throw notFound()
  }

  return signDevelopmentInitData(token, telegramId, Math.floor(Date.now() / 1_000))
})
