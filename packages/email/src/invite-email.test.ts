import { readFileSync } from "node:fs"

import { CoachLanguages } from "@praximo/domain"
import { render, toPlainText } from "@react-email/render"
import { describe, expect, it } from "@effect/vitest"

import { inviteEmailCopy } from "./invite-email-copy.ts"
import { InviteEmail } from "./invite-email.tsx"

const COACH = "Олена Пшенична"
const ACCEPTANCE_URL = "https://me.praximo.io/i/a1b2c3d4e5f6"
const MARK = "https://me.praximo.io/brand/praximo-mark.png"

const html = (locale: (typeof CoachLanguages)[number]) =>
  render(InviteEmail({ locale, coachName: COACH, acceptanceUrl: ACCEPTANCE_URL, markUrl: MARK }))

describe("InviteEmail", () => {
  it.each(CoachLanguages)(
    "renders %s with the coach's name in a nominative frame",
    async (locale) => {
      const output = await html(locale)
      const copy = inviteEmailCopy(locale)
      expect(output).toContain(copy.heading(COACH))
      // The name arrives from an operator-entered field and must land unchanged:
      // no locale may phrase it into a case (#222, docs/agents/product-copy.md).
      expect(output).toContain(COACH)
      expect(copy.subject(COACH)).toContain(COACH)
    },
  )

  // Buttons get stripped and people paste links into a real browser, so the URL
  // has to survive as text — including in the plain-text part, which is all some
  // readers ever see.
  it.each(CoachLanguages)(
    "carries the acceptance URL in both parts of the %s email",
    async (locale) => {
      const output = await html(locale)
      expect(output).toContain(ACCEPTANCE_URL)
      expect(toPlainText(output)).toContain(ACCEPTANCE_URL)
    },
  )

  // Most inboxes block remote images by default. The footer has to read as the
  // brand for a client who never unblocks them.
  it("names the brand in text as well as in the image", async () => {
    const output = await html("en")
    expect(output).toContain(`alt="Praximo"`)
    expect(output).toContain(MARK)
    expect(toPlainText(output)).toContain("Praximo")
  })

  // A frozen document cannot be corrected, and a session can move (#62). The
  // page is where the truth lives; the email only has to get the client there.
  it("says nothing about a session", async () => {
    const output = await html("ru")
    expect(output).not.toMatch(/\d{1,2}:\d{2}/)
  })

  // Not a stylistic preference: the barrel drags in @react-email/tailwind, whose
  // module-level init builds a CSS engine and blows the Workers startup-CPU
  // budget (react-email#1508) — a deploy-time crash no rendering test catches.
  //
  // Asserted against the manifest rather than against this file's imports: an
  // uninstalled dependency cannot be imported from anywhere in the package,
  // which is a guard that survives the next template as well as this one.
  it("does not depend on the @react-email/components barrel or on tailwind", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly dependencies: Record<string, string> }
    expect(Object.keys(manifest.dependencies)).not.toContain("@react-email/components")
    expect(Object.keys(manifest.dependencies)).not.toContain("@react-email/tailwind")
  })
})

describe("inviteEmailCopy", () => {
  it.each(CoachLanguages)("fills every level for %s", (locale) => {
    const copy = inviteEmailCopy(locale)
    expect(copy.subject(COACH).length).toBeGreaterThan(0)
    expect(copy.preview.length).toBeGreaterThan(0)
    expect(copy.lead.length).toBeGreaterThan(0)
    expect(copy.action.length).toBeGreaterThan(0)
    expect(copy.linkFallback.length).toBeGreaterThan(0)
    expect(copy.expiry.length).toBeGreaterThan(0)
    expect(copy.footer.about.length).toBeGreaterThan(0)
    expect(copy.footer.noReply.length).toBeGreaterThan(0)
  })

  // The catalogue is not strict, so a missing key falls back to English rather
  // than throwing at a coach mid-send. This is what proves none of them do.
  it("translates uk and ru rather than falling back", () => {
    const en = inviteEmailCopy("en")
    for (const locale of ["uk", "ru"] as const) {
      const copy = inviteEmailCopy(locale)
      expect(copy.action).not.toBe(en.action)
      expect(copy.lead).not.toBe(en.lead)
      expect(copy.footer.about).not.toBe(en.footer.about)
    }
  })
})
