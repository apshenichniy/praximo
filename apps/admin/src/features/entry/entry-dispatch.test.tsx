import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { EntryScreen } from "@/features/entry/components/entry-screen.tsx"
import { coachScreen, entryView } from "@/features/entry/entry-view.ts"
import type { ViewerRoleTransportResult } from "@/server/viewer-role.functions.ts"
import type { ViewerRole } from "@/server/viewer-role.ts"

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8")

const workspaceId = "ws_ada" as ViewerRole.ViewerCoach["workspaceId"]

const accepted = {
  state: "accepted",
  workspaceId,
  link: "https://t.me/PraximoBot?start=ws_ADA23456",
} as const satisfies ViewerRole.ViewerCoach

const botConnected = {
  state: "bot-connected",
  workspaceId,
  botUsername: "ada_coach_bot",
  link: "https://t.me/ada_coach_bot",
} as const satisfies ViewerRole.ViewerCoach

const active = { ...botConnected, state: "active" } as const satisfies ViewerRole.ViewerCoach

const ok = (role: ViewerRole.Role): ViewerRoleTransportResult => ({ ok: true, role })

const render = (view: Exclude<ReturnType<typeof entryView>, { kind: "admin" }>) =>
  renderToStaticMarkup(<EntryScreen view={view} onRetry={() => {}} />)

describe("manager Mini App entry dispatch", () => {
  it("sends an admin to the admin tree without surfacing a coach handoff", () => {
    expect(entryView(ok({ isAdmin: true, coach: null }))).toEqual({ kind: "admin" })
    expect(entryView(ok({ isAdmin: true, coach: accepted }))).toEqual({ kind: "admin" })

    const adminHome = src("routes/admin/index.tsx")
    const coachList = src("features/admin/components/coach-list.tsx")
    expect(`${adminHome}\n${coachList}`).not.toMatch(
      /Open my coach bot|Continue my coach setup|ViewerCoachCard/,
    )
  })

  it("routes every coach state to the coach screen", () => {
    for (const coach of [accepted, botConnected, active]) {
      expect(entryView(ok({ isAdmin: false, coach }))).toEqual({ kind: "coach", coach })
    }
  })

  it("lands an unknown viewer and a rejected credential on the same screen", () => {
    expect(entryView(ok({ isAdmin: false, coach: null }))).toEqual({ kind: "landing" })
    expect(entryView({ ok: false, error: "unauthenticated" })).toEqual({ kind: "landing" })
  })

  it("keeps a broken gate distinct from an unknown viewer", () => {
    expect(entryView({ ok: false, error: "server" })).toEqual({ kind: "unavailable" })
  })

  it("tells a mid-onboarding coach where to continue, without an expiry", () => {
    const screen = coachScreen(accepted)
    expect(screen.action).toBe("Continue in chat")
    expect(screen.steps.map((step) => step.state)).toEqual(["done", "current", "upcoming"])
    // Acceptance retires the seven-day TTL (#112), so the coach is never shown
    // a deadline for a claim that no longer has one.
    expect(`${screen.title} ${screen.body}`).not.toMatch(/expires in|days left|countdown/i)

    const markup = render({ kind: "coach", coach: accepted })
    expect(markup).toContain("Your workspace is reserved")
    expect(markup).toContain("Invitation accepted")
  })

  it("hands a bot-connected coach the activation step", () => {
    const screen = coachScreen(botConnected)
    expect(screen.action).toBe("Open your bot")
    expect(screen.steps.map((step) => step.state)).toEqual(["done", "done", "current"])
    expect(render({ kind: "coach", coach: botConnected })).toContain("Your coach bot is ready")
  })

  it("gives an active coach a pointer rather than a progression", () => {
    const screen = coachScreen(active)
    expect(screen.steps).toEqual([])
    expect(render({ kind: "coach", coach: active })).toContain("Your workspace lives in your bot")
  })

  it("renders the invite-only landing with no admin content and no 404", () => {
    const markup = render({ kind: "landing" })
    expect(markup).toContain("Praximo is invite-only")
    // Naming the administrator as the way in is trust copy (#112); anything
    // *from* the admin surface would be the leak.
    expect(markup).not.toMatch(/Praximo Admin|Coaches|Invite a coach/)
    expect(markup).not.toMatch(/not found/i)
  })

  it("offers a retry when the gate itself failed", () => {
    const markup = render({ kind: "unavailable" })
    expect(markup).toContain("Try again")
    expect(markup).not.toMatch(/not found/i)
  })

  it("mounts the admin tree only behind the resolved role", () => {
    // Collapsed whitespace: the invariant is which expression guards the
    // Outlet, not how the formatter happened to wrap it.
    const route = src("routes/admin/route.tsx").replaceAll(/\s+/g, " ")

    // The Outlet — every admin screen — is reachable through exactly one
    // expression, and it is the one the gate answers.
    expect(route).toContain('view.kind === "admin" ? <Outlet />')
    expect(route.match(/<Outlet \/>/g)).toHaveLength(1)
    // No viewer is mapped to a missing page any more. The route keeps a
    // not-found *component* for genuinely unknown child URLs — which only an
    // admin can reach — but nothing on the entry path throws one.
    expect(route).not.toMatch(/notFound\(\)/)
    // The list is prefetched inside the admin branch, never for a viewer whose
    // role has not been established.
    expect(route).toMatch(/if \(view\.kind === "admin"\) \{\s*await context\.queryClient/)
  })

  it("paints a role-neutral frame while the gate resolves", () => {
    const loading = src("components/entry-loading.tsx")

    expect(src("routes/admin/route.tsx")).toContain("pendingComponent: EntryLoading")
    expect(loading).not.toMatch(/Praximo Admin|Coaches|Invite a coach/)
  })
})
