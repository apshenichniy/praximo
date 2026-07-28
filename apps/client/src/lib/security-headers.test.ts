import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { SECURITY_HEADERS, withSecurityHeaders } from "@/lib/security-headers.ts"

describe("security headers", () => {
  it("refuses to send a referrer at all", () => {
    // Not `same-origin`, not `strict-origin`: the token is in the *path*, and
    // both of those still hand the full URL to a same-origin destination.
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("no-referrer")
  })

  it("puts them on a response without dropping what was already there", async () => {
    const original = new Response("body", {
      status: 201,
      headers: { "content-type": "text/plain", "x-kept": "yes" },
    })

    const sealed = withSecurityHeaders(original)

    expect(sealed.headers.get("referrer-policy")).toBe("no-referrer")
    expect(sealed.headers.get("content-type")).toBe("text/plain")
    expect(sealed.headers.get("x-kept")).toBe("yes")
    expect(sealed.status).toBe(201)
    expect(await sealed.text()).toBe("body")
  })

  /**
   * A `Response` from `Response.redirect` carries immutable headers, and
   * `headers.set` on one throws. The app is about to start serving redirects, so
   * a header policy that turned those into a 500 would be found in production
   * rather than here.
   */
  it("seals a response whose headers cannot be mutated in place", () => {
    const redirect = Response.redirect("https://me.praximo.io/legal/privacy", 301)

    expect(() => redirect.headers.set("x-nope", "1")).toThrow()

    const sealed = withSecurityHeaders(redirect)

    expect(sealed.status).toBe(301)
    expect(sealed.headers.get("location")).toBe("https://me.praximo.io/legal/privacy")
    expect(sealed.headers.get("referrer-policy")).toBe("no-referrer")
  })

  /**
   * The header is worth nothing unless something applies it to every response,
   * and the only place that happens is a request middleware registered on the
   * Start instance. Asserted against the source because the alternative — a
   * route-level header somebody adds by hand — looks identical at the call site
   * and is wrong for every route added afterwards.
   */
  it("is applied by a request middleware on the Start instance", () => {
    const start = readFileSync(fileURLToPath(new URL("../start.ts", import.meta.url)), "utf8")

    expect(start).toContain('createMiddleware({ type: "request" })')
    expect(start).toContain("withSecurityHeaders(result.response)")
    expect(start).toContain("requestMiddleware: [securityHeaders]")
  })
})
