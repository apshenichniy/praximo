/**
 * What a Mini App launch hands the server about who is looking.
 *
 * `botId` is the `?b=` a Workspace Bot's Mini App URL carries, so the server can
 * verify the launch's signature against a named bot before it reads anything
 * (ADR 0006). The Manager Bot's URL carries none, so an empty selector is an
 * ordinary answer rather than a failure.
 */
export interface LaunchCredential {
  readonly initData: string
  readonly botId: string
}

export interface LaunchCredentialResolverOptions {
  readonly isDevelopment: boolean
  readonly readInitData: () => Promise<string | undefined>
  readonly readBotId?: () => string
  readonly loadDevelopmentInitData?: ((botId: string) => Promise<string>) | undefined
}

/**
 * Read the launch credential once per page load.
 *
 * Telegram never refreshes `initData` after launch. Memoizing also prevents
 * every server call from waiting on the SDK or minting a fresh local credential.
 */
export const createLaunchCredentialResolver = (
  options: LaunchCredentialResolverOptions,
): (() => Promise<LaunchCredential>) => {
  let pending: Promise<LaunchCredential> | undefined

  const read = async (): Promise<LaunchCredential> => {
    const botId = options.readBotId?.() ?? ""
    const initData = await options.readInitData()
    if (initData) return { initData, botId }

    if (options.isDevelopment && options.loadDevelopmentInitData !== undefined) {
      const minted = await options.loadDevelopmentInitData(botId).catch(() => "")
      return { initData: minted, botId }
    }

    return { initData: "", botId }
  }

  return () => (pending ??= read())
}

export const INIT_DATA_HEADER = "x-praximo-init-data"
export const BOT_ID_HEADER = "x-praximo-bot-id"

export const launchCredentialHeaders = (
  credential: LaunchCredential,
): Readonly<Record<string, string>> => ({
  [INIT_DATA_HEADER]: credential.initData,
  [BOT_ID_HEADER]: credential.botId,
})

export const launchCredentialFromHeaders = (
  readHeader: (name: string) => string | undefined,
): LaunchCredential => ({
  initData: readHeader(INIT_DATA_HEADER) ?? "",
  botId: readHeader(BOT_ID_HEADER) ?? "",
})
