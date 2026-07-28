import { loadDevelopmentAdminInitData } from "@/server/development-admin-credential.ts"
import { readPresentationInitData } from "@/presentation-host"

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

const read = async (): Promise<LaunchCredential> => {
  const botId = ""
  const initData = await readPresentationInitData()
  if (initData) return { initData, botId }

  // Local Vite only: a short-lived signed credential, so the real verifier and
  // the real database gate run in development instead of being stubbed out.
  if (import.meta.env.DEV) {
    const minted = await loadDevelopmentAdminInitData().catch(() => "")
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
