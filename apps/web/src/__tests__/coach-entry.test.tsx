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
import { MainMiniAppScreen } from "@/features/coach/components/main-mini-app-screen.tsx"
import { TermsScreen } from "@/features/coach/components/terms-screen.tsx"
import { coachCatalog, coachCopy } from "@/features/i18n/coach-copy.ts"
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

/**
 * A practice with nothing in it — the state reachable without `db:demo`, and
 * therefore the one every entry test runs against unless it says otherwise.
 */
const emptyPractice = {
  ok: true,
  today: {
    coachName: "Olena P.",
    timezone: "Europe/Kyiv",
    sessions: [],
    attention: [],
    emptyPractice: true,
    mainMiniAppHintVisible: true,
  },
} as const

const screen = (entry: CoachEntryTransportResult, launchLanguage: "en" | "uk" | "ru" = "en") =>
  render(
    <CoachScreen
      entry={entry}
      launchLanguage={launchLanguage}
      today={emptyPractice}
      onAccept={() => {}}
      onChooseLanguage={async () => true}
      onCreate={() => {}}
      onResend={() => {}}
      onRetry={() => {}}
      pending={false}
      resending={undefined}
      error={undefined}
    />,
  )

const termsRequired = (language: "en" | "uk" | "ru" = "en"): CoachEntryTransportResult => ({
  ok: true,
  entry: { kind: "terms-required", termsVersion: TERMS_VERSION, language },
})

const home = (language: "en" | "uk" | "ru" = "en"): CoachEntryTransportResult => ({
  ok: true,
  entry: {
    kind: "home",
    botUsername: "ada_coach_bot",
    telegramBotId: "9100777",
    language,
  },
})

describe("coach Mini App entry", () => {
  /**
   * First login opens on the language, not on the terms (#130). The coach has
   * to know what language Praximo will speak to them *before* being asked to
   * agree to anything in it — and the sentence that says so is the step's
   * content, in the first person, rather than a caption under a switcher.
   */
  it("opens first login on the language step, in the language already seeded", async () => {
    const html = await screen(termsRequired("uk"))

    expect(html).toContain(coachCatalog.uk.language.greeting)
    expect(html).toContain(coachCatalog.uk.language.introduction)
    // The sentence that carries the consequence — that this governs the bot too.
    expect(html).toContain(coachCatalog.uk.language.writesLead.trim())
    expect(html).toContain(coachCatalog.uk.language.writesEmphasis)
    // All three offered, each named in its own tongue.
    expect(html).toContain("English")
    expect(html).toContain("Українська")
    expect(html).toContain("Русский")
    // The terms are the step after this one, not this one.
    expect(html).not.toContain(coachCatalog.uk.terms.title)
    expect(html).not.toContain(coachCatalog.uk.terms.points[0])
  })

  it("blocks an unaccepted coach with the terms and links both full texts", async () => {
    const html = await render(
      <TermsScreen
        copy={coachCopy("en")}
        locale="en"
        onAccept={() => {}}
        pending={false}
        error={undefined}
      />,
    )

    expect(html).toContain("Before you start")
    expect(html).toContain("assistive, not authoritative")
    expect(html).toContain("/legal/terms")
    expect(html).toContain("/legal/privacy")
    // No way past it but through: declining is closing the app, and a control
    // that ends onboarding with no way back is a trap rather than a choice.
    expect(html).not.toContain("Decline")
  })

  /**
   * The full texts are public routes with no credential to read a member from,
   * so the language rides on the link. Without this the coach reads a summary
   * in Russian and taps through to an English contract.
   */
  it("carries the coach's language into the full legal texts", async () => {
    const html = await render(
      <TermsScreen
        copy={coachCopy("ru")}
        locale="ru"
        onAccept={() => {}}
        pending={false}
        error={undefined}
      />,
    )

    expect(html).toContain(coachCatalog.ru.terms.title)
    expect(html).toContain(coachCatalog.ru.terms.points[0])
    expect(html).toContain("/legal/terms?lang=ru")
    expect(html).toContain("/legal/privacy?lang=ru")
  })

  /**
   * Today is the entrance now (#61), and the practice a coach reaches a minute
   * after accepting the terms has nothing in it — so it opens on the checklist
   * rather than on three ways of looking at nothing.
   */
  it("lands an onboarded coach on Today", async () => {
    const html = await screen(home())
    expect(html).toContain("Olena P.")
    expect(html).toContain(coachCatalog.en.today.checklistTitle)
    expect(html).toContain(coachCatalog.en.today.allSessions)
    expect(html).toContain(coachCatalog.en.today.clients)
    // The bot step opens ticked; the clients list has moved to its own route.
    expect(html).toContain(coachCatalog.en.today.checklistBot)
    expect(html).toContain('href="/clients"')
    expect(html).toContain('href="/sessions"')
  })

  it("speaks Today in the coach's own language", async () => {
    const html = await screen(home("ru"))
    expect(html).toContain(coachCatalog.ru.today.checklistTitle)
    expect(html).toContain(coachCatalog.ru.home.mainMiniAppRow)
  })

  /**
   * The hint is one row opening a screen (#61) — the steps, the address and the
   * Hide control all live there, so Today carries no dismiss control at all.
   */
  it("offers the @BotFather hint as one row, and no way to dismiss it here", async () => {
    const html = await screen(home())
    expect(html).toContain(coachCatalog.en.home.mainMiniAppRow)
    expect(html).toContain('href="/main-mini-app"')
    expect(html).not.toContain(coachCatalog.en.home.mainMiniAppHide)
    // The address itself belongs to the screen behind the row, not to Today.
    expect(html).not.toContain(coachCatalog.en.home.mainMiniAppUrlLabel)
  })

  it("prints the exact per-bot address @BotFather asks for", async () => {
    // Telegram has no API for the chat-list button, so the coach pastes this
    // themselves — and only the app knows the bot id. The path is reset along
    // with the query: the address is printed on `/main-mini-app`, and one
    // ending there would send every chat-list launch to the hint.
    expect(mainMiniAppUrlFor("https://stage.praximo.io/?b=old&x=1#frag", "9100777")).toBe(
      "https://stage.praximo.io/?b=9100777",
    )
    expect(mainMiniAppUrlFor("https://stage.praximo.io/main-mini-app", "9100777")).toBe(
      "https://stage.praximo.io/?b=9100777",
    )
    expect(mainMiniAppUrlFor("", "9100777")).toBe("")

    const html = await render(
      <MainMiniAppScreen
        copy={coachCopy("en")}
        mainMiniAppUrl="https://stage.praximo.io/?b=9100777"
        onHide={() => {}}
      />,
    )
    expect(html).toContain("https://stage.praximo.io/?b=9100777")
    // Hide lives here and only here.
    expect(html).toContain(coachCatalog.en.home.mainMiniAppHide)
  })

  it("says where the app opens from rather than showing a missing page", async () => {
    expect(await screen({ ok: false, error: "unauthenticated" })).toContain(
      "Open Praximo from your bot",
    )
    expect(await screen({ ok: false, error: "server" })).toContain("Try again")
  })

  /**
   * A refusal happens before any member is resolved, so there is no
   * `member.language` to render it in. The launch's own claimed language is all
   * there is, and it is better than English at a coach who does not read it.
   */
  it("reports a refusal in the language the launch itself claims", async () => {
    const html = await screen({ ok: false, error: "unauthenticated" }, "uk")
    expect(html).toContain(coachCatalog.uk.entry.notFromBotTitle)

    const failed = await screen({ ok: false, error: "server" }, "ru")
    expect(failed).toContain(coachCatalog.ru.entry.unavailableTitle)
    expect(failed).toContain(coachCatalog.ru.common.tryAgain)
  })

  it("renders both legal texts without a credential, in every language", async () => {
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

    // The same version identifies the translated documents: they are the same
    // contract, and the record of what a coach accepted has to mean one thing.
    const ukrainian = await render(
      <LegalPage document={coachTermsFor("uk")} version={TERMS_VERSION} locale="uk" />,
    )
    expect(ukrainian).toContain(coachTermsFor("uk").title)
    expect(ukrainian).toContain(TERMS_VERSION)
    expect(ukrainian).toContain('lang="uk"')
    expect(ukrainian).toContain("[operator legal name and address]")

    const russian = await render(
      <LegalPage document={privacyPolicyFor("ru")} version={PRIVACY_VERSION} locale="ru" />,
    )
    expect(russian).toContain(privacyPolicyFor("ru").title)
    expect(russian).toContain("Deepgram")
    expect(russian).toContain('lang="ru"')
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
