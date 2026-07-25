import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { LegalPage } from "@/features/legal/components/legal-page.tsx"
import { coachTermsFor, privacyPolicyFor } from "@/features/legal/content.ts"
import { PRIVACY_VERSION, TERMS_VERSION } from "@/features/legal/versions.ts"
import { CoachHome } from "@/features/coach/components/coach-home.tsx"
import { acceptOnce, CoachScreen, mainMiniAppUrlFor } from "@/routes/index.tsx"
import type { CoachEntryTransportResult } from "@/server/coach.functions.ts"

/**
 * The screens carry internal links, so they need a router to render at all. A
 * throwaway one is enough — nothing here exercises navigation, only what each
 * state of the entry actually puts on the page.
 */
const render = async (node: ReactNode): Promise<string> => {
  const rootRoute = createRootRoute({ component: () => node })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/legal/terms" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/legal/privacy" }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  await router.load()
  return renderToStaticMarkup(<RouterProvider router={router as never} />)
}

const screen = (entry: CoachEntryTransportResult, onAccept = () => {}) =>
  render(
    <CoachScreen
      entry={entry}
      onAccept={onAccept}
      onRetry={() => {}}
      pending={false}
      error={undefined}
    />,
  )

const termsRequired: CoachEntryTransportResult = {
  ok: true,
  entry: { kind: "terms-required", termsVersion: TERMS_VERSION },
}

const home: CoachEntryTransportResult = {
  ok: true,
  entry: {
    kind: "home",
    botUsername: "ada_coach_bot",
    telegramBotId: "9100777",
    language: "en",
  },
}

describe("coach Mini App entry", () => {
  it("blocks an unaccepted coach with the terms and links both full texts", async () => {
    const html = await screen(termsRequired)
    expect(html).toContain("Before you start")
    expect(html).toContain("assistive, not authoritative")
    expect(html).toContain("/legal/terms")
    expect(html).toContain("/legal/privacy")
    // No way past it but through: declining is closing the app, and a control
    // that ends onboarding with no way back is a trap rather than a choice.
    expect(html).not.toContain("Decline")
  })

  it("shows an onboarded coach their bot", async () => {
    const html = await screen(home)
    expect(html).toContain("Your workspace is active")
    expect(html).toContain("@ada_coach_bot")
  })

  it("prints the exact per-bot address @BotFather asks for", async () => {
    // The one operational element on the home stub: Telegram has no API for the
    // chat-list button, so the coach pastes this themselves — and only the app
    // knows the bot id.
    expect(mainMiniAppUrlFor("https://stage.praximo.io/?b=old&x=1#frag", "9100777")).toBe(
      "https://stage.praximo.io/?b=9100777",
    )
    expect(mainMiniAppUrlFor("", "9100777")).toBe("")

    const html = await render(
      <CoachHome
        botUsername="ada_coach_bot"
        mainMiniAppUrl="https://stage.praximo.io/?b=9100777"
      />,
    )
    expect(html).toContain("https://stage.praximo.io/?b=9100777")
  })

  it("says where the app opens from rather than showing a missing page", async () => {
    expect(await screen({ ok: false, error: "unauthenticated" })).toContain(
      "Open Praximo from your bot",
    )
    expect(await screen({ ok: false, error: "server" })).toContain("Try again")
  })

  it("renders both legal texts without a credential", async () => {
    const terms = await render(
      <LegalPage document={coachTermsFor("en")} version={TERMS_VERSION} locale="en" />,
    )
    expect(terms).toContain("Coach terms of service")
    expect(terms).toContain(TERMS_VERSION)
    // The placeholders are shown, not silently blanked: an unfinished contract
    // clause that reads as finished is worse than one that admits it.
    expect(terms).toContain("[operator legal name and address]")

    const privacy = await render(
      <LegalPage document={privacyPolicyFor("en")} version={PRIVACY_VERSION} locale="en" />,
    )
    expect(privacy).toContain("Privacy policy")
    expect(privacy).toContain(PRIVACY_VERSION)
    expect(privacy).toContain("Deepgram")
  })
})

describe("terms acceptance", () => {
  it("fires one acceptance however many times the button is tapped", async () => {
    const accept = vi.fn(async () => {
      await Promise.resolve()
    })
    const inFlight = { current: false }

    acceptOnce(inFlight, accept)
    acceptOnce(inFlight, accept)
    acceptOnce(inFlight, accept)
    expect(accept).toHaveBeenCalledTimes(1)

    // …and the button works again once the first one has landed, so a failure
    // is retryable rather than terminal.
    await new Promise((resolve) => setTimeout(resolve, 0))
    acceptOnce(inFlight, accept)
    expect(accept).toHaveBeenCalledTimes(2)
  })
})
