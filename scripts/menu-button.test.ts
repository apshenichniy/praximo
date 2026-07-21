import { describe, expect, it } from "@effect/vitest"
import { adminUrlForOrigin, buildSetMenuButtonRequest, MENU_BUTTON_TEXT } from "./menu-button.ts"

// The pure half of bot:set-menu, tested with no env and no network — the HTTPS
// guard and payload shape are the parts that must not be got wrong when pointing
// a live bot at a URL.

describe("adminUrlForOrigin", () => {
  it("appends /admin to a bare origin", () => {
    expect(adminUrlForOrigin("https://praximo-dev-alex-web.example.workers.dev")).toBe(
      "https://praximo-dev-alex-web.example.workers.dev/admin",
    )
  })

  it("replaces any existing path, query, and hash", () => {
    expect(adminUrlForOrigin("https://host.workers.dev/health?x=1#frag")).toBe(
      "https://host.workers.dev/admin",
    )
  })

  it("rejects a non-https origin", () => {
    expect(() => adminUrlForOrigin("http://host.workers.dev")).toThrow(/must be https/)
  })

  it("rejects a malformed origin", () => {
    expect(() => adminUrlForOrigin("not a url")).toThrow(/invalid web origin/)
  })
})

describe("buildSetMenuButtonRequest", () => {
  it("puts the token in the endpoint and a web_app button in the body", () => {
    const request = buildSetMenuButtonRequest({
      botToken: "123:ABC",
      adminUrl: "https://host.workers.dev/admin",
    })
    expect(request.endpoint).toBe("https://api.telegram.org/bot123:ABC/setChatMenuButton")
    expect(request.body).toEqual({
      menu_button: {
        type: "web_app",
        text: MENU_BUTTON_TEXT,
        web_app: { url: "https://host.workers.dev/admin" },
      },
    })
  })

  it("rejects an empty token", () => {
    expect(() =>
      buildSetMenuButtonRequest({ botToken: "", adminUrl: "https://host/admin" }),
    ).toThrow(/missing bot token/)
  })

  it("rejects a non-https admin url", () => {
    expect(() =>
      buildSetMenuButtonRequest({ botToken: "123:ABC", adminUrl: "http://host/admin" }),
    ).toThrow(/must be https/)
  })
})
