import { loadDevelopmentAdminInitData } from "@/server/development-admin-credential.ts"
import { loadDevelopmentCoachInitData } from "@/server/development-coach-credential.ts"
import { loadTelegramWebApp, readTelegramInitData, revealTelegramWebApp } from "@/lib/telegram.ts"

/**
 * What a Mini App launch hands the server about who is looking.
 *
 * `botId` is the `?b=` a coach bot's Mini App URL carries, so the server can
 * verify the launch's signature against a named bot before it reads anything
 * (ADR 0006). The manager bot's URL carries none, and a coach bot provisioned
 * before that URL grew the parameter carries none either — `""` is the ordinary
 * answer for both, not a failure.
 */
export interface LaunchCredential {
  readonly initData: string
  readonly botId: string
}

const readBotId = (): string =>
  typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("b") ?? "")

const read = async (): Promise<LaunchCredential> => {
  const botId = readBotId()
  const webApp = await loadTelegramWebApp()
  if (webApp) revealTelegramWebApp(webApp)

  const initData = readTelegramInitData(webApp)
  if (initData) return { initData, botId }

  // Local Vite only: a short-lived signed credential, so the real verifier and
  // the real database gate run in development instead of being stubbed out.
  // Which one is minted follows the same thing that distinguishes the two trees
  // in a Telegram host — a coach bot's Mini App URL names its bot, the manager
  // bot's does not.
  if (import.meta.env.DEV) {
    const minted =
      botId.length === 0
        ? await loadDevelopmentAdminInitData().catch(() => "")
        : await loadDevelopmentCoachInitData({ data: { botId } }).catch(() => "")
    return { initData: minted, botId }
  }

  // Outside a Telegram host there is nobody to identify. That is an answer, not
  // a failure: the entry renders the invite-only landing for it, and the empty
  // string carries it all the way to a server that cannot verify it either.
  return { initData: "", botId }
}

let pending: Promise<LaunchCredential> | undefined

/**
 * The launch credential, read once per page load.
 *
 * Memoized because it is now attached to *every* server call rather than
 * resolved once at the entry: without this each call would wait on the Telegram
 * SDK, and in development each would mint a fresh credential. Telegram never
 * refreshes `initData` after launch, so one read is also the honest number.
 */
export const resolveLaunchCredential = (): Promise<LaunchCredential> => (pending ??= read())
