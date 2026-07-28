/**
 * The pure half of the manager-bot menu-button setup (#80), kept free of `process`
 * and network so the URL/payload shaping — above all the HTTPS guard — is unit
 * testable. The runner in `scripts/set-menu-button.ts` supplies the real env,
 * performs the `setChatMenuButton` call, and logs.
 *
 * The operator opens the admin Mini App from the manager bot's chat menu button
 * (admin-surface.md §Auth): a `web_app` button pointing at the stage's deployed
 * `/admin`. The URL is per-stage, so it is derived from the deployed Admin
 * origin at setup time, never a committed constant.
 */

/**
 * The BotFather-style chat menu label shared by both manager-bot entry points.
 * Coach bots carry the same word, set at provisioning
 * (`CoachMenuButtonText` in `apps/bot/src/provisioning.ts`, #86); the two live
 * apart because `scripts/` is outside the workspace graph.
 */
export const MENU_BUTTON_TEXT = "Open"

/**
 * The admin route URL for a stage, from its deployed Admin Worker origin (the
 * `adminUrl` Alchemy output). Telegram requires an HTTPS `web_app` URL, so a
 * non-HTTPS origin is rejected here rather than silently accepted by the API.
 */
export const adminUrlForOrigin = (adminOrigin: string): string => {
  let url: URL
  try {
    url = new URL(adminOrigin)
  } catch {
    throw new Error(`invalid admin origin: ${adminOrigin}`)
  }
  if (url.protocol !== "https:") {
    throw new Error(`admin origin must be https (Telegram web_app requirement): ${adminOrigin}`)
  }
  url.pathname = "/admin"
  url.search = ""
  url.hash = ""
  return url.toString()
}

/**
 * The `getMe` flags that report whether a stage's manual @BotFather setup was
 * done. Both are read-only — no Bot API can set either — so a script can only
 * observe them and say what is missing.
 */
export interface ManagerBotCapabilities {
  readonly has_main_web_app?: boolean
  readonly can_manage_bots?: boolean
}

/**
 * What is still un-done in @BotFather for this manager bot, as lines to print.
 *
 * Both flags fail *silently and far from here*: nothing errors at deploy, and
 * nothing errors when the bot sends its keyboard — the gap only shows up on a
 * phone, minutes or days later, as a button that does nothing. That is what
 * makes them worth a preflight at the one moment an operator is already
 * pointed at this bot.
 *
 * `can_manage_bots` is the consequential one and is deliberately listed first:
 * without it Telegram will not serve `request_managed_bot` at all, so the
 * coach's "Create coach bot" button opens a generic share sheet that spins and
 * completes nothing (observed on iOS, 2026-07-25). Warnings rather than a
 * throw: pointing the menu button at a stage is a legitimate thing to do on a
 * bot that has not been fully configured yet.
 */
export const managerBotSetupWarnings = (
  capabilities: ManagerBotCapabilities,
): ReadonlyArray<string> => {
  const warnings: Array<string> = []
  if (!capabilities.can_manage_bots) {
    warnings.push(
      "bot management is OFF (`can_manage_bots: false`) — one-tap coach provisioning cannot work: " +
        "Telegram will not serve the `request_managed_bot` button, and the coach sees a share sheet " +
        "that never completes. Enable bot management for this bot in the @BotFather Mini App " +
        "(ADR 0004 §Prerequisites). The @BotFather token-paste fallback keeps working meanwhile.",
    )
  }
  if (!capabilities.has_main_web_app) {
    warnings.push(
      "Main Mini App is not enabled — the chat-list Open button will be missing. " +
        "Configure /admin in @BotFather (#84). The in-chat menu button this script sets is unaffected.",
    )
  }
  return warnings
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
