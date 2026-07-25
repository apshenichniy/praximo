/**
 * The pure half of the manager-bot menu-button setup (#80), kept free of `process`
 * and network so the URL/payload shaping — above all the HTTPS guard — is unit
 * testable. The runner in `scripts/set-menu-button.ts` supplies the real env,
 * performs the `setChatMenuButton` call, and logs.
 *
 * The operator opens the admin Mini App from the manager bot's chat menu button
 * (admin-surface.md §Auth): a `web_app` button pointing at the stage's deployed
 * `/admin`. The URL is per-stage, so it is derived from the deployed web origin at
 * setup time, never a committed constant.
 */

/**
 * The BotFather-style chat menu label shared by both manager-bot entry points.
 * Coach bots carry the same word, set at provisioning
 * (`CoachMenuButtonText` in `apps/bot/src/provisioning.ts`, #86); the two live
 * apart because `scripts/` is outside the workspace graph.
 */
export const MENU_BUTTON_TEXT = "Open"

/**
 * The admin route URL for a stage, from its deployed `web` Worker origin (the
 * `webUrl` Alchemy output). Telegram requires an HTTPS `web_app` URL, so a
 * non-HTTPS origin is rejected here rather than silently accepted by the API.
 */
export const adminUrlForOrigin = (webOrigin: string): string => {
  let url: URL
  try {
    url = new URL(webOrigin)
  } catch {
    throw new Error(`invalid web origin: ${webOrigin}`)
  }
  if (url.protocol !== "https:") {
    throw new Error(`web origin must be https (Telegram web_app requirement): ${webOrigin}`)
  }
  url.pathname = "/admin"
  url.search = ""
  url.hash = ""
  return url.toString()
}

export interface SetMenuButtonRequest {
  readonly endpoint: string
  readonly body: {
    readonly menu_button: {
      readonly type: "web_app"
      readonly text: string
      readonly web_app: { readonly url: string }
    }
  }
}

/**
 * The `setChatMenuButton` request for the manager bot: endpoint carries the token,
 * body points the default menu button at the admin Mini App. `adminUrl` is
 * re-validated as HTTPS — the destructive-by-omission API call must never depend
 * on the caller having guarded first.
 */
export const buildSetMenuButtonRequest = (config: {
  readonly botToken: string
  readonly adminUrl: string
}): SetMenuButtonRequest => {
  if (!config.botToken) {
    throw new Error("missing bot token")
  }
  const adminUrl = new URL(config.adminUrl)
  if (adminUrl.protocol !== "https:") {
    throw new Error(`admin url must be https: ${config.adminUrl}`)
  }
  return {
    endpoint: `https://api.telegram.org/bot${config.botToken}/setChatMenuButton`,
    body: {
      menu_button: {
        type: "web_app",
        text: MENU_BUTTON_TEXT,
        web_app: { url: adminUrl.toString() },
      },
    },
  }
}
