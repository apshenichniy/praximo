import { describe, expect, it } from "vitest"

import { legalUrl } from "@praximo/i18n"
import { legalRedirect } from "@/server/legal-redirect.ts"

const ORIGIN = "https://my.praximo.io"

const location = (response: Response) => response.headers.get("location")

describe("legalUrl", () => {
  it("addresses each text on the client app, in the language asked for", () => {
    expect(legalUrl(ORIGIN, "privacy", "ru")).toBe("https://my.praximo.io/legal/privacy?lang=ru")
    expect(legalUrl(ORIGIN, "terms", "uk")).toBe("https://my.praximo.io/legal/terms?lang=uk")
  })

  it("does not double the slash when the origin carries one", () => {
    expect(legalUrl("https://my.praximo.io/", "terms", "en")).toBe(
      "https://my.praximo.io/legal/terms?lang=en",
    )
  })

  /**
   * These are public pages, and the bot builds this from an origin that may
   * carry `?b=<botId>`. A consent button that forwarded it would say something
   * about who was sent it.
   */
  it("drops whatever the origin was carrying", () => {
    expect(legalUrl("https://my.praximo.io/?b=9100777#x", "privacy", "ru")).toBe(
      "https://my.praximo.io/legal/privacy?lang=ru",
    )
  })

  /**
   * Total on purpose: a coach reading the terms they are about to accept must
   * not meet an exception because a binding was set to something odd. There is
   * no throwing path at all — the callers that need to *know* an origin is
   * usable check it themselves, which is what `legalRedirect` does below.
   */
  it("never throws, whatever it is handed", () => {
    expect(legalUrl("not a url", "privacy", "en")).toBe("not a url/legal/privacy?lang=en")
    expect(legalUrl("", "terms", "uk")).toBe("/legal/terms?lang=uk")
  })
})

describe("legalRedirect", () => {
  it("permanently redirects to the client app", () => {
    const response = legalRedirect(ORIGIN, "privacy", "https://app.praximo.io/legal/privacy")

    // Permanent, because the move is: the texts are not coming back to this app.
    expect(response.status).toBe(301)
    expect(location(response)).toBe("https://my.praximo.io/legal/privacy?lang=en")
    // …but the *destination* is configuration, and on a dev stage it is a
    // rotating workers.dev host. A permanently cached pair would strand a
    // developer on a Worker that no longer exists.
    expect(response.headers.get("cache-control")).toBe("no-cache")
  })

  /**
   * The language is the whole content of these links. A client sent a Russian
   * policy must not land on an English one because a redirect dropped a query.
   */
  it("carries the language across", () => {
    for (const language of ["ru", "uk", "en"]) {
      const response = legalRedirect(
        ORIGIN,
        "terms",
        `https://app.praximo.io/legal/terms?lang=${language}`,
      )
      expect(location(response)).toBe(`https://my.praximo.io/legal/terms?lang=${language}`)
    }
  })

  /**
   * Re-narrowed rather than passed through: forwarding an arbitrary
   * caller-supplied string into a `Location` header is not a thing to do, and
   * the product speaks three languages.
   */
  it("narrows a language it does not speak to the floor", () => {
    const response = legalRedirect(
      ORIGIN,
      "terms",
      "https://app.praximo.io/legal/terms?lang=de%0d%0aX-Injected:%201",
    )

    expect(location(response)).toBe("https://my.praximo.io/legal/terms?lang=en")
    expect(response.headers.get("x-injected")).toBeNull()
  })

  /**
   * Unreachable in a deployed stage — the Alchemy stack always binds the origin,
   * and the Worker refuses to boot without it. Asserted anyway, because the
   * alternative to saying so out loud is redirecting to a relative path, which
   * would loop this route into itself.
   */
  it("says so rather than looping when no origin is configured", () => {
    for (const origin of ["", "not a url", "ftp://my.praximo.io"]) {
      const response = legalRedirect(origin, "privacy", "https://app.praximo.io/legal/privacy")
      expect(response.status).toBe(500)
      expect(location(response)).toBeNull()
    }
  })
})
