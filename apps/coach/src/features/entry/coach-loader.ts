import type { CoachLanguage } from "@praximo/domain"
import { launchLocale } from "@/features/i18n/launch-locale.ts"
import { type CoachEntryTransportResult, loadCoachEntry } from "@/server/coach-surface.functions.ts"
import { resolveLaunchCredential } from "./launch-credential.ts"

/**
 * A read the browser could not complete, in the words the server would have used.
 *
 * There is nothing a screen can do differently about a request that never
 * arrived: it draws the same «недоступно» frame with the same retry either way,
 * so a rejected promise becoming `server` is honesty rather than laziness — the
 * one thing the screen must not do is throw and lose the launch with it.
 */
export const orServerFailure = <A>(
  read: Promise<A>,
): Promise<A | { readonly ok: false; readonly error: "server" }> =>
  read.catch(() => ({ ok: false, error: "server" }) as const)

/**
 * What every coach route resolves before it can draw anything (#234).
 *
 * Eleven loaders each opened by asking for the same two things and deriving the
 * same third; this is that trio, once. It is one round trip rather than two —
 * both halves come from the same launch and the credential is memoized — so a
 * route that also needs its own read still costs exactly what it did before,
 * with `Promise.all` around this and that.
 */
export interface CoachLaunch {
  readonly entry: CoachEntryTransportResult
  /**
   * What the launch itself claims, for the two refusals above an authenticated
   * coach: at that point there is no member to ask (#130).
   */
  readonly launchLanguage: CoachLanguage
  /**
   * The language a coach's own screens render in — their `member.language` once
   * there is a coach, and what their Telegram client asked for until then.
   *
   * The entry route does *not* use this: onboarding's screens are shown to a
   * coach who exists but has not accepted the terms, and those render in the
   * language that coach was seeded with rather than in the launch's.
   */
  readonly language: CoachLanguage
}

export const coachLaunch = async (): Promise<CoachLaunch> => {
  const [entry, credential] = await Promise.all([
    orServerFailure(loadCoachEntry()),
    resolveLaunchCredential(),
  ])
  const launchLanguage = launchLocale(credential.initData)
  return {
    entry,
    launchLanguage,
    language: entry.ok && entry.entry.kind === "home" ? entry.entry.language : launchLanguage,
  }
}
