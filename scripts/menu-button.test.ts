import { describe, expect, it } from "@effect/vitest"
import {
  adminUrlForOrigin,
  buildSetMenuButtonRequest,
  managerBotSetupWarnings,
  MENU_BUTTON_TEXT,
} from "./menu-button.ts"

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
  it('builds the manager bot web_app button with the "Open" label', () => {
    const request = buildSetMenuButtonRequest({
      botToken: "123:ABC",
      adminUrl: "https://host.workers.dev/admin",
    })
    expect(MENU_BUTTON_TEXT).toBe("Open")
    expect(request.endpoint).toBe("https://api.telegram.org/bot123:ABC/setChatMenuButton")
    expect(request.body).toEqual({
      menu_button: {
        type: "web_app",
        text: "Open",
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

// Both flags are manual @BotFather steps that fail silently and far from here —
// the symptom is a dead button on someone's phone — so the preflight is the one
// place a script can name them.

describe("managerBotSetupWarnings", () => {
  it("is silent when both manual steps are done", () => {
    expect(managerBotSetupWarnings({ has_main_web_app: true, can_manage_bots: true })).toEqual([])
  })

  it("warns about bot management first, and says what it costs", () => {
    const [first] = managerBotSetupWarnings({ has_main_web_app: true, can_manage_bots: false })
    expect(first).toMatch(/can_manage_bots/)
    expect(first).toMatch(/one-tap coach provisioning cannot work/)
    // The fallback still works, and an operator staring at a dead button needs
    // to know that before they start looking for a bug in our code.
    expect(first).toMatch(/token-paste fallback/)
  })

  it("warns about the Main Mini App without implying the menu button is affected", () => {
    const [first] = managerBotSetupWarnings({ has_main_web_app: false, can_manage_bots: true })
    expect(first).toMatch(/Main Mini App/)
    expect(first).toMatch(/in-chat menu button this script sets is unaffected/)
  })

  it("reports both, bot management first", () => {
    const warnings = managerBotSetupWarnings({})
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatch(/can_manage_bots/)
    expect(warnings[1]).toMatch(/Main Mini App/)
  })
})
