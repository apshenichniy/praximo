import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { CoachLanguages } from "@praximo/domain"
import { clientCopy } from "@praximo/i18n"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AcceptancePage } from "@/features/invite/acceptance-page.tsx"
import { ConfirmationScreen, RefusalScreen } from "@/features/invite/notice-screen.tsx"

const COACH = "Олена Пшенична"
const SESSION = {
  scheduledAt: "2026-08-05T08:00:00.000Z",
  durationMinutes: 60,
  kind: "intake",
} as const

/** The consent pane carries a link, so the tree needs a router to render at all. */
const render = async (node: ReactNode): Promise<string> => {
  const rootRoute = createRootRoute({ component: () => node })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/legal/privacy" }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  await router.load()
  return renderToStaticMarkup(<RouterProvider router={router as never} />)
}

const page = (locale: (typeof CoachLanguages)[number] = "ru") =>
  render(
    <AcceptancePage
      locale={locale}
      coachName={COACH}
      session={SESSION}
      coachTimezone="Europe/Kyiv"
      submitting={false}
      onSubmit={() => {}}
    />,
  )

describe("the acceptance page", () => {
  /**
   * The debt #222 left behind, and the reason it is a test rather than a note.
   *
   * The ru and uk consent texts say «ваш коуч» instead of declining a proper
   * noun. That decision rests entirely on the claim that the reader can see
   * whose page this is in the surrounding frame — so if the greeting ever goes,
   * what is left is a legally operative document that never names the party it
   * is about, in two of three languages, and nothing else would catch it.
   */
  it("names the coach in the frame, in every language", async () => {
    for (const locale of CoachLanguages) {
      expect(await page(locale)).toContain(COACH)
    }
  })

  it("renders the consent structurally, from the shared catalogue", async () => {
    const html = await page("ru")
    const consent = clientCopy("ru").consent

    expect(html).toContain(consent.title)
    // Five points, as an ordered list rather than one blob of text.
    expect(html).toContain("<ol")
    for (const point of consent.points(COACH)) expect(html).toContain(point)
    // `<li[ >]`, not `<li`: the latter also matches every `<link>` on the page.
    expect(html.match(/<li[ >]/g)).toHaveLength(5)
    // And the numerals the design puts in the margin.
    expect(html).toContain("01")
    expect(html).toContain("05")
  })

  /** No markup from the catalogue reaches the page — the reason #57 moved `<b>`. */
  it("shows the consent title as a heading, not as a literal tag", async () => {
    const html = await page("ru")
    expect(html).not.toContain("&lt;b&gt;")
    expect(html).toContain(`<h1 class`)
  })

  /**
   * Root-relative, and asserted as such. The policy is on this same Worker, so
   * reading an origin off `window` would buy nothing and cost a hydration
   * mismatch — the server has no `window` and would render a different `href`,
   * which React reports and refuses to patch up.
   */
  it("opens the privacy policy in a new tab, in the page's language", async () => {
    const html = await page("uk")
    expect(html).toContain('href="/legal/privacy?lang=uk"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
  })

  /**
   * The coach's private label — «Анна через Марину» — never reaches the client.
   * The field arrives empty and the client names themselves.
   */
  it("leaves the name field empty", async () => {
    const html = await page("ru")
    const nameInput = html.slice(html.indexOf("<input"), html.indexOf("<input") + 400)
    expect(nameInput).not.toContain(COACH)
    expect(nameInput).not.toMatch(/value="[^"]+"/)
  })

  /**
   * The commit is server-rendered **disabled**: the gate unlocks in an effect,
   * which never runs during SSR, and a button that is live for the moment before
   * hydration is a button somebody can press before the gate exists.
   */
  it("ships the commit locked", async () => {
    const html = await page("ru")
    expect(html).toContain("disabled")
    expect(html).toContain(clientCopy("ru").consent.agreeButton)
  })
})

describe("the screens that are not the happy path", () => {
  /**
   * The link opened a second time, which will happen. It says so and discloses
   * **no session details**: the token is spent, and turning a forwarded
   * invitation into a permanent read-only view of somebody's schedule is not a
   * trade worth making.
   */
  it("tells an already-accepted link nothing about the schedule", async () => {
    const html = await render(
      <RefusalScreen locale="ru" kind="already-accepted" coachName={COACH} />,
    )
    expect(html).toContain("Вы уже подключены")
    expect(html).not.toContain("августа")
    expect(html).not.toContain("10:00")
  })

  it("names who to ask for a link that expired or was replaced", async () => {
    expect(await render(<RefusalScreen locale="ru" kind="expired" coachName={COACH} />)).toContain(
      COACH,
    )
    expect(
      await render(<RefusalScreen locale="ru" kind="superseded" coachName={COACH} />),
    ).toContain(COACH)
  })

  /** A typo and a token-guessing script get the same page, and it names nobody. */
  it("keeps the unknown refusal anonymous", async () => {
    const html = await render(<RefusalScreen locale="ru" kind="unknown" />)
    expect(html).not.toContain(COACH)
    expect(html).toContain("не работает")
  })

  /**
   * The address echoed back is the whole of the email verification in MVP: a
   * typo stays catchable while the client is still looking at the screen.
   */
  it("echoes the address the reminders will go to", async () => {
    const html = await render(
      <ConfirmationScreen
        locale="ru"
        coachName={COACH}
        email="maria@example.com"
        session={SESSION}
        coachTimezone="Europe/Kyiv"
      />,
    )
    expect(html).toContain("maria@example.com")
    expect(html).toContain("Готово")
  })
})
