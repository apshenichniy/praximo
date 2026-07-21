import { adminUrlForOrigin, buildSetMenuButtonRequest } from "./menu-button.ts"

/**
 * `bun run manager-bot:set-menu <web-origin>` — point the dev manager bot's chat menu
 * button at the stage's deployed `/admin`, so the operator opens the admin Mini
 * App "the normal way" from their phone (#80, admin-surface.md §Auth).
 *
 * One-time per stage, run after `alchemy deploy`. The web origin is the deploy's
 * `webUrl` output (per-stage, never committed); the token comes from the root
 * `.env`. The pure shaping/guards live in `menu-button.ts`; this runner only
 * supplies env + args, makes the call, and logs.
 *
 *   bun run manager-bot:set-menu https://praximo-dev-<user>-web.<subdomain>.workers.dev
 */

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`missing ${name} — set it in the root .env (see .env.example)`)
  }
  return value
}

const webOrigin = process.argv[2] ?? process.env.WEB_URL
if (!webOrigin) {
  throw new Error(
    "missing web origin — pass the deployed web URL as the first argument " +
      "(the `webUrl` from `alchemy deploy`), e.g. manager-bot:set-menu https://…workers.dev",
  )
}

const adminUrl = adminUrlForOrigin(webOrigin)
const request = buildSetMenuButtonRequest({
  botToken: requireEnv("MANAGER_BOT_TOKEN"),
  adminUrl,
})

console.log(`bot:set-menu — pointing the manager bot's menu button at ${adminUrl}`)

const response = await fetch(request.endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(request.body),
})

const result = (await response.json()) as { ok: boolean; description?: string }
if (!response.ok || !result.ok) {
  throw new Error(
    `setChatMenuButton failed (${response.status}): ${result.description ?? "unknown error"}`,
  )
}

console.log(`bot:set-menu — done: the chat menu button now opens ${adminUrl}`)
