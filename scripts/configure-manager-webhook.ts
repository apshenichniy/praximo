import { fileURLToPath } from "node:url"
import { configureManagerWebhook } from "./manager-webhook.ts"

const requireEnvironment = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`missing ${name}`)
  return value
}

export const main = async (): Promise<void> => {
  await configureManagerWebhook({
    token: requireEnvironment("MANAGER_BOT_TOKEN"),
    secret: requireEnvironment("MANAGER_BOT_WEBHOOK_SECRET"),
    workerUrl: requireEnvironment("MANAGER_BOT_WEBHOOK_URL"),
  })
  console.info("Manager bot webhook configured.")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
