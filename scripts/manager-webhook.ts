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
        allowed_updates: ["message", "managed_bot"],
      }),
    },
  )
  const body = (await response.json()) as { readonly ok?: boolean }
  if (!response.ok || body.ok !== true) {
    throw new Error(`Telegram rejected manager webhook configuration (${response.status})`)
  }
}
