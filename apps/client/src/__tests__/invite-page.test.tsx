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

import { inviteCopy } from "@/features/i18n/invite-copy.ts"
import { AcceptancePage, keepTyped } from "@/features/invite/acceptance-page.tsx"
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

  /**
   * These two say who to ask, and the name reaches the reader through the
   * *frame* rather than the sentence: «попросите у …» is genitive, and
   * `docs/agents/product-copy.md` forbids declining an operator-entered string.
   * So the screen owes a nominative slot — and this is what says it kept it.
   */
  it("names who to ask for a link that expired or was replaced", async () => {
    for (const kind of ["expired", "superseded"] as const) {
      const html = await render(<RefusalScreen locale="ru" kind={kind} coachName={COACH} />)
      expect(html).toContain(COACH)
      expect(html).toContain("Ваш коуч")
      // Not inside the sentence, which would need a case nobody can compute.
      expect(html).not.toContain(`у ${COACH}`)
    }
  })

  /** The commit ships locked, and stays locked until an identity is given. */
  it("does not offer a commit before the fields are filled", async () => {
    const html = await page("ru")
    const button = html.slice(html.lastIndexOf("<button"))
    expect(button).toContain("disabled")
  })

  /**
   * Google is offered or it is absent — never disabled. A dead control on a
   * legally operative page is the placeholder-reads-as-a-promise failure this
   * page was built on refusing, and #57 shipped the column finished without one.
   */
  it("draws no Google affordance where there is no import to offer", async () => {
    const html = await page("ru")
    expect(html).not.toContain("Google")
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

/**
 * The address the invitation arrived at, offered back (#58).
 *
 * The name and the email are deliberately asymmetric, and these are what hold
 * that apart: the name arrives empty because what the coach typed is *their*
 * private label, while the address is one this client has already been reached
 * at and retyping it is copying from the message that brought them.
 */
describe("the pre-filled address", () => {
  it("fills the email field from the invitation and leaves the name empty", async () => {
    const html = await render(
      <AcceptancePage
        locale="ru"
        coachName={COACH}
        suggestedEmail="anna@example.com"
        submitting={false}
        onSubmit={() => {}}
      />,
    )

    expect(html).toContain('value="anna@example.com"')
    // The client names themselves. The coach's label — «Анна через Марину» —
    // stays in the coach's list and is never shown back, so the name field is
    // the one input that still renders empty.
    expect(html).toContain('value=""')
    expect(html).not.toContain(`value="${COACH}"`)
  })

  // A hand-forwarded link has no address behind it, and the field is blank.
  it("leaves the field empty when the invitation was not emailed", async () => {
    const html = await page()

    expect(html).not.toContain("anna@example.com")
  })
})

/**
 * The coach's face, where the platform has one (#231).
 *
 * The photo is what makes this page read as a continuation of the client's
 * conversation with their coach rather than a stranger's consent wall — and the
 * initials are what most clients will actually see, so both have to be right.
 */
/**
 * The Google import as the page presents it (#59).
 *
 * The criterion this file can hold is the sharpest one the ticket has: **no
 * Google script, request or cookie before the button is pressed.** A rendered
 * page either reaches Google or it does not, and that is a string search away.
 */
describe("Continue with Google", () => {
  const googlePage = (
    locale: (typeof CoachLanguages)[number] = "ru",
    props: Partial<Parameters<typeof AcceptancePage>[0]> = {},
  ) =>
    render(
      <AcceptancePage
        locale={locale}
        coachName={COACH}
        submitting={false}
        onSubmit={() => {}}
        googleAvailable
        onGoogleImport={() => {}}
        {...props}
      />,
    )

  it("reaches Google for nothing at all before it is pressed", async () => {
    const html = await googlePage()

    // The whole reason the button is ours rather than Google Identity Services:
    // no script, no iframe, no remote mark, nothing to set a cookie with.
    expect(html).not.toContain("accounts.google.com")
    expect(html).not.toContain("gsi/client")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("googleusercontent")
    // The mark is inlined, so even the logo costs no request.
    expect(html).toContain("<svg")
    expect(html).not.toMatch(/<img[^>]+https?:\/\//)
  })

  it("uses Google's own wording, in Google's own translations", async () => {
    const wording: Record<(typeof CoachLanguages)[number], string> = {
      en: "Continue with Google",
      uk: "Продовжити з Google",
      ru: "Продолжить с Google",
    }
    for (const locale of CoachLanguages) {
      expect(await googlePage(locale)).toContain(wording[locale])
    }
  })

  /** Absent, never disabled — see the sibling case above the fields. */
  it("is gone entirely when the stage has no import to offer", async () => {
    const html = await render(
      <AcceptancePage
        locale="ru"
        coachName={COACH}
        submitting={false}
        onSubmit={() => {}}
        googleAvailable={false}
        onGoogleImport={() => {}}
      />,
    )
    expect(html).not.toContain("Google")
  })

  it("replaces the button with a line saying where the data came from", async () => {
    const html = await googlePage("ru", {
      imported: { name: "Олена", email: "olena@example.com", emailVerified: true },
    })

    expect(html).not.toContain("Продолжить с Google")
    expect(html).toContain(inviteCopy("ru").form.googleDone)
    // Nothing claims the fields are verified: they stay ordinary editable
    // fields, and a badge would be a claim the next keystroke makes false.
    expect(html).not.toContain("verified")
  })

  it("does not call an unconfirmed address confirmed", async () => {
    const html = await googlePage("ru", {
      imported: { email: "olena@example.com", emailVerified: false },
    })
    expect(html).toContain(inviteCopy("ru").form.googleDoneUnverified)
    expect(html).not.toContain(inviteCopy("ru").form.googleDone)
  })

  /** A declined consent screen is the client's own decision, not an error. */
  it("says a failed import quietly, and keeps the fields as the way through", async () => {
    const html = await googlePage("ru", { googleFailed: true })

    expect(html).toContain(inviteCopy("ru").form.googleFailed)
    expect(html).toContain(inviteCopy("ru").form.nameLabel)
    expect(html).toContain(inviteCopy("ru").form.emailLabel)
  })

  it("restores what was typed before a full-page import left the page", async () => {
    const html = await googlePage("ru", {
      draft: { read: () => ({ name: "Олена", email: "olena@example.com" }), write: () => {} },
    })

    expect(html).toContain('value="Олена"')
    expect(html).toContain('value="olena@example.com"')
  })

  /**
   * The draft is the more recent truth, including when the client deliberately
   * cleared the address the invitation was emailed to before pressing.
   */
  it("does not put back an address the client had cleared", async () => {
    const html = await googlePage("ru", {
      suggestedEmail: "old@example.com",
      draft: { read: () => ({ name: "Олена", email: "" }), write: () => {} },
    })
    expect(html).not.toContain("old@example.com")
  })
})

/**
 * The rule that keeps an import from costing the client what they wrote.
 *
 * Held here as a function rather than through a render, because it is a rule
 * about a *transition* — an import arriving over fields that are already filled —
 * and this app's suite runs without a DOM to transition in.
 */
describe("filling from the import", () => {
  it("fills an empty field and leaves a typed one alone", () => {
    expect(keepTyped("Олена")("")).toBe("Олена")
    expect(keepTyped("Олена")("Марина")).toBe("Марина")
  })

  it("changes nothing when Google offered nothing", () => {
    expect(keepTyped(undefined)("Марина")).toBe("Марина")
    expect(keepTyped(undefined)("")).toBe("")
  })

  /**
   * The address field is **pre-filled** for every emailed invitation (#58).
   * Treating that as the client's own writing meant Google's address silently
   * never landed for exactly the clients the invitation had reached by email —
   * while the line above the fields told them it had.
   */
  it("replaces an address the server suggested, which nobody typed", () => {
    expect(keepTyped("olena@gmail.com", "old@example.com")("old@example.com")).toBe(
      "olena@gmail.com",
    )
  })

  it("still refuses to overwrite one the client typed over the suggestion", () => {
    expect(keepTyped("olena@gmail.com", "old@example.com")("mine@example.com")).toBe(
      "mine@example.com",
    )
  })
})

describe("the coach's photo", () => {
  const PHOTO = "/i/ABCDEFGH2345/coach-avatar"

  it("draws the photo on the greeting when there is one to draw", async () => {
    const html = await render(
      <AcceptancePage
        locale="ru"
        coachName={COACH}
        coachPhotoSrc={PHOTO}
        submitting={false}
        onSubmit={() => {}}
      />,
    )

    // The invitation's own address, so nothing about R2 is in the markup a client
    // is handed — and the name is still in the frame, which #222's consent text
    // depends on.
    expect(html).toContain(`src="${PHOTO}"`)
    expect(html).not.toContain("avatars/")
    expect(html).toContain(COACH)
  })

  it("falls back to initials without asking for anything", async () => {
    const html = await page()

    // Not a placeholder: no request goes out for a coach with no photo, and the
    // monogram is what #57 shipped.
    expect(html).not.toContain("coach-avatar")
    expect(html).toContain("ОП")
  })

  it("shows the coach on the confirmation and on a refusal too", async () => {
    const confirmation = await render(
      <ConfirmationScreen
        locale="ru"
        coachName={COACH}
        coachPhotoSrc={PHOTO}
        email="anna@example.com"
      />,
    )
    // `expired`, not `already-accepted`: only the refusals that *name* the coach
    // draw the badge at all, and a spent link deliberately names nobody.
    const refusal = await render(
      <RefusalScreen locale="ru" kind="expired" coachName={COACH} coachPhotoSrc={PHOTO} />,
    )

    // Every screen that names the coach shows their face: the confirmation is the
    // one that reads as a continuation, and an expired link says who to ask.
    expect(confirmation).toContain(`src="${PHOTO}"`)
    expect(refusal).toContain(`src="${PHOTO}"`)
  })
})
