import { adminUrlForOrigin, buildSetMenuButtonRequest } from "./menu-button.ts"

/**
 * `bun run manager-bot:set-menu <web-origin>` — point the dev manager bot's chat menu
 * button at the stage's deployed `/admin`, so the operator opens the admin Mini
 * App "the normal way" from their phone (#80, admin-surface.md §Entry points).
 *
 * One-time per stage, run after `alchemy deploy`. The web origin is the deploy's
 * `webUrl` output (per-stage, never committed); the token comes from the root
 * `.env`. The pure shaping/guards live in `menu-button.ts`; this runner only
 * supplies env + args, checks whether the manual Main Mini App setup is visible
 * through `getMe`, makes the call, and logs.
 *
 *   bun run manager-bot:set-menu https://stage.praximo.io
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
      "(the `webUrl` from `alchemy deploy`), e.g. manager-bot:set-menu https://stage.praximo.io",
  )
}

const adminUrl = adminUrlForOrigin(webOrigin)
const botToken = requireEnv("MANAGER_BOT_TOKEN")
const request = buildSetMenuButtonRequest({
  botToken,
  adminUrl,
})

const getMeResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
const getMe = (await getMeResponse.json()) as {
  readonly ok: boolean
  readonly description?: string
  readonly result?: {
    readonly username?: string
    readonly has_main_web_app?: boolean
  }
}
if (!getMeResponse.ok || !getMe.ok || !getMe.result) {
  throw new Error(`getMe failed (${getMeResponse.status}): ${getMe.description ?? "unknown error"}`)
}
if (!getMe.result.has_main_web_app) {
  console.warn(
    "bot:set-menu — warning: Main Mini App is not enabled; configure /admin in @BotFather " +
      "to expose the chat-list Open button",
  )
}

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
