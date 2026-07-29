import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { coachTermsFor, PRIVACY_VERSION, privacyPolicyFor, TERMS_VERSION } from "@praximo/i18n"
import { interfaceTypographyRoles, typographyRecipe } from "@praximo/ui"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LegalPage } from "@/features/legal/components/legal-page.tsx"

/**
 * The renderer carries internal links between the two texts, so it needs a
 * router to render at all. A throwaway one is enough — nothing here exercises
 * navigation, only what lands on the page.
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

describe("legal pages", () => {
  it("renders both texts without a credential, in every language", async () => {
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

  it("keeps the page header on the shared semantic recipes", async () => {
    const html = await render(
      <LegalPage document={coachTermsFor("en")} version={TERMS_VERSION} locale="en" />,
    )

    // Title and version are interface chrome and stay on the recipes.
    expect(html).toContain("text-3xl")
    expect(html).toContain("text-xs")
    expect(html).not.toMatch(/\bmd:text-/)
  })

  /**
   * The boundary #223 draws, held from the consuming side: the document is a
   * reading column, so nothing inside it carries an interface type role and
   * nothing inside it hand-spaces its own blocks.
   */
  it("renders the document through the prose layer and nothing else", async () => {
    const html = await render(
      <LegalPage document={privacyPolicyFor("en")} version={PRIVACY_VERSION} locale="en" />,
    )

    // Everything below the prose container's own opening tag. The container
    // carries the layout margin that separates chrome from prose; what the
    // boundary is about is what happens inside it.
    expect(html).toContain("typeset typeset-document")
    const prose = html.slice(html.indexOf(">", html.indexOf("typeset typeset-document")))
    expect(prose).toContain("typeset-scroll")

    // No interface type role reaches inside the prose block — asked of the
    // recipe itself rather than of a list somebody has to remember to extend.
    for (const role of interfaceTypographyRoles) {
      for (const className of typographyRecipe({ role }).split(" ")) {
        expect(prose, `${role}'s ${className} inside the prose block`).not.toContain(className)
      }
    }

    // Neither does hand-spacing: the flow between blocks is the stylesheet's.
    expect(prose).not.toMatch(/\bm[tby]-\d/)
    expect(prose).not.toMatch(/\bspace-y-\d/)
    expect(prose).not.toMatch(/\bp[lr]-\d/)
  })
})
