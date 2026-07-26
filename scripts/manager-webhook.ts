/**
 * What Telegram is asked to deliver to the manager bot.
 *
 * An omitted type is not merely unhandled — it never arrives. `callback_query`
 * had to be added the moment the creation prompt grew a button that answers
 * rather than navigates (#164): without it the coach taps "I already have a
 * bot", Telegram shows its loading state, and nothing ever comes back.
 *
 * Applied by `setWebhook`, so a change here needs
 * `bun run manager-bot:set-webhook` against each stage. A deploy alone does not
 * move it.
 */
const AllowedUpdates = ["message", "callback_query", "managed_bot"] as const

export interface ManagerWebhookConfig {
  readonly token: string
  readonly secret: string
  readonly workerUrl: string
}

export const endpointFor = (workerUrl: string): string => {
  const url = new URL(workerUrl)
  if (url.protocol !== "https:") throw new Error("manager bot worker URL must use https")
  url.pathname = "/telegram/manager"
  url.search = ""
  url.hash = ""
  return url.toString()
}

export const configureManagerWebhook = async (
  config: ManagerWebhookConfig,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> => {
  const endpoint = endpointFor(config.workerUrl)
  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(config.token)}/setWebhook`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: endpoint,
        secret_token: config.secret,
        allowed_updates: AllowedUpdates,
      }),
    },
  )
  const body = (await response.json()) as { readonly ok?: boolean }
  if (!response.ok || body.ok !== true) {
    throw new Error(`Telegram rejected manager webhook configuration (${response.status})`)
  }
}
