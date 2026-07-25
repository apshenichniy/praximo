import { WorkspaceDescriptionMaxLength, WorkspaceShortDescriptionMaxLength } from "@praximo/domain"

/**
 * Every coach bot is born Praximo-branded (#108). The admin no longer sets a
 * description or an avatar — the coach owns their bot's identity and rebrands
 * it from their side — so provisioning has to hand them something deliberate to
 * start from rather than an empty profile.
 *
 * What is left here is the text half: pure functions of the coach's name, so a
 * retried provisioning reproduces the same bot rather than re-skinning one the
 * coach has since made their own. The picture is no longer computed at all — it
 * is one image per stage, stored in R2 at `DEFAULT_COACH_BOT_AVATAR_R2_KEY` and
 * replaced by upload (`bun run branding:avatar:set`), because a brand asset
 * belongs to whoever owns the brand, not to a gradient table in a Worker (#138).
 */

const clamp = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`

/** "Coaching with Ada · powered by Praximo" — the templated bot description. */
export const defaultBotDescription = (coachName: string): string => {
  const name = coachName.trim()
  const text =
    name.length === 0
      ? "Coaching, powered by Praximo"
      : `Coaching with ${name} · powered by Praximo`
  return clamp(text, WorkspaceDescriptionMaxLength)
}

/** The one-liner Telegram shows above the chat before the first message. */
export const defaultBotShortDescription = (coachName: string): string => {
  const name = coachName.trim()
  const text = name.length === 0 ? "Coaching, powered by Praximo" : `Coaching with ${name}`
  return clamp(text, WorkspaceShortDescriptionMaxLength)
}
