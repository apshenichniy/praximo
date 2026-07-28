import type { ViewerRoleTransportResult } from "@/server/viewer-role.functions.ts"
import type { ViewerRole } from "@/server/viewer-role.ts"

/**
 * Which screen the manager Mini App's entry renders (#106). One value, resolved
 * before anything paints, so no surface can start rendering for the wrong
 * viewer: the admin tree is only ever mounted under `admin`.
 *
 * `landing` is the answer for both an unknown viewer and a rejected credential.
 * They differ in cause, not in what the person can do about it — nobody without
 * an invitation has anything to open here — and collapsing them keeps the
 * screen from hinting at which Telegram identities the platform knows.
 */
export type EntryView =
  | { readonly kind: "admin" }
  | { readonly kind: "coach"; readonly coach: ViewerRole.ViewerCoach }
  | { readonly kind: "landing" }
  | { readonly kind: "unavailable" }

/**
 * Admin wins whenever the viewer is one, even if they are also a coach: the
 * admin surface is the richer screen and carries its own contextual coach
 * action (#107), so a dual-role person keeps a single, unchanged entry.
 */
export const entryView = (result: ViewerRoleTransportResult): EntryView => {
  if (!result.ok)
    return result.error === "unauthenticated" ? { kind: "landing" } : { kind: "unavailable" }
  if (result.role.isAdmin) return { kind: "admin" }
  const coach = result.role.coach
  return coach === null ? { kind: "landing" } : { kind: "coach", coach }
}

export type CoachStepState = "done" | "current" | "upcoming"

export interface CoachStep {
  readonly title: string
  readonly description: string
  readonly state: CoachStepState
}

export interface CoachScreen {
  readonly title: string
  readonly body: string
  readonly action: string
  readonly steps: ReadonlyArray<CoachStep>
}

const step = (title: string, description: string, state: CoachStepState): CoachStep => ({
  title,
  description,
  state,
})

/**
 * What a coach who lands on the manager entry is told, and the one thing they
 * can do about it. This is the stub the full onboarding companion replaces
 * (#119), so it deliberately reports only what the entry itself already knows —
 * the claim, the bot, the activation — rather than mirroring a checklist whose
 * middle states live in the manager chat.
 *
 * An active coach is not mid-onboarding at all: their screen is a pointer to
 * where their workspace actually lives, and it never expires into something
 * else, so it carries no progression.
 */
export const coachScreen = (coach: ViewerRole.ViewerCoach): CoachScreen => {
  // A broken bot is not a step of onboarding, so it carries no progression
  // either — it is one thing to be done, in the one chat that can still do it
  // (#55). The companion this stub becomes (#119) renders the same state with
  // the rest of its checklist.
  if (coach.state === "needs-relink") {
    return {
      title: "Your coach bot needs reconnecting",
      body: "Telegram no longer accepts your bot's token, so it has stopped answering. Nothing in your workspace is lost — reconnect it from the chat with the Praximo bot.",
      action: "Reconnect in chat",
      steps: [],
    }
  }

  if (coach.state === "active") {
    return {
      title: "Your workspace lives in your bot",
      body: "This chat is where Praximo set your workspace up. Everything else — sessions, clients, and artifacts — happens in your own coach bot.",
      action: "Open your bot",
      steps: [],
    }
  }

  if (coach.state === "bot-connected") {
    return {
      title: "Your coach bot is ready",
      body: "Open your bot to sign in for the first time and accept the terms. That last step activates your workspace.",
      action: "Open your bot",
      steps: [
        step("Invitation accepted", "This workspace is reserved for you.", "done"),
        step("Coach bot connected", "Telegram finished creating your bot.", "done"),
        step("Workspace activated", "Sign in from your bot and accept the terms.", "current"),
      ],
    }
  }

  return {
    title: "Your workspace is reserved",
    body: "Continue in the chat with the Praximo bot to create your coach bot. The workspace stays reserved for you — there is no deadline.",
    action: "Continue in chat",
    steps: [
      step("Invitation accepted", "This workspace is reserved for you.", "done"),
      step("Coach bot connected", "Create your bot from the Praximo chat.", "current"),
      step("Workspace activated", "Sign in from your bot and accept the terms.", "upcoming"),
    ],
  }
}
