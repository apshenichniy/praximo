import { fileURLToPath } from "node:url"
import { configureManagerWebhook } from "./manager-webhook.ts"
import { requireEnv } from "./env.ts"

export const main = async (): Promise<void> => {
  await configureManagerWebhook({
    token: requireEnv("MANAGER_BOT_TOKEN"),
    secret: requireEnv("MANAGER_BOT_WEBHOOK_SECRET"),
    workerUrl: requireEnv("MANAGER_BOT_WEBHOOK_URL"),
  })
  console.info("Manager bot webhook configured.")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
