import {
  adminUrlForOrigin,
  buildSetMenuButtonRequest,
  managerBotSetupWarnings,
} from "./menu-button.ts"
import { requireEnv } from "./env.ts"

/**
 * `bun run manager-bot:set-menu <admin-origin>` — point the active manager bot's chat menu
 * button at the Admin Worker's `/admin`, so the operator opens the admin Mini
 * App "the normal way" from their phone (#80, admin-surface.md §Entry points).
 *
 * One-time per stage, run after `alchemy deploy`. The web origin is the deploy's
 * `adminUrl` output (per-stage, never committed); the token comes from the root
 * `.env`. The pure shaping/guards live in `menu-button.ts`; this runner only
 * supplies env + args, checks whether the manual Main Mini App setup is visible
 * through `getMe`, makes the call, and logs.
 *
 *   bun run manager-bot:set-menu https://admin.praximo.io
 */

const adminOrigin = process.argv[2] ?? process.env.ADMIN_URL
if (!adminOrigin) {
  throw new Error(
    "missing Admin origin — pass the deployed Admin URL as the first argument " +
      "(the `adminUrl` from `alchemy deploy`), e.g. manager-bot:set-menu https://admin.praximo.io",
  )
}

const adminUrl = adminUrlForOrigin(adminOrigin)
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
    readonly can_manage_bots?: boolean
  }
}
if (!getMeResponse.ok || !getMe.ok || !getMe.result) {
  throw new Error(`getMe failed (${getMeResponse.status}): ${getMe.description ?? "unknown error"}`)
}
for (const warning of managerBotSetupWarnings(getMe.result)) {
  console.warn(`bot:set-menu — warning: ${warning}`)
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
