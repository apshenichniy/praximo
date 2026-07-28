import { type CoachLanguage, DefaultCoachLanguage, narrowCoachLanguage } from "@praximo/domain"

/**
 * The language a launch *claims*, read out of the raw `initData` without
 * verifying it.
 *
 * That is safe here and nowhere else: this is used only by the screens shown
 * when no member could be resolved — a launch from outside a coach bot, or a
 * server that did not answer — where the alternative is not "something safer",
 * it is English at a coach who may not read it. It authorizes nothing, and every
 * screen that belongs to an identified coach uses `member.language` instead.
 *
 * The narrowing is the domain's, so `uk-UA` means the same thing here as it does
 * in the bot (#130).
 */
export const launchLocale = (initData: string): CoachLanguage => {
  try {
    const user = new URLSearchParams(initData).get("user")
    if (user === null) return DefaultCoachLanguage
    const parsed: unknown = JSON.parse(user)
    const code =
      typeof parsed === "object" && parsed !== null && "language_code" in parsed
        ? (parsed as { readonly language_code?: unknown }).language_code
        : undefined
    return narrowCoachLanguage(typeof code === "string" ? code : undefined)
  } catch {
    // Malformed `initData` is not this function's problem to report: whatever
    // sent it is about to be refused by the verifier anyway.
    return DefaultCoachLanguage
  }
}
