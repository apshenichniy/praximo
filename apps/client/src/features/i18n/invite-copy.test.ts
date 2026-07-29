import { CoachLanguages } from "@praximo/domain"
import { describe, expect, it } from "vitest"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"

const COACH = "Олена Пшенична"

/**
 * Every sentence the catalogue can produce, keyed by where it lives.
 *
 * Enumerated by hand rather than walked reflectively: the functions here take
 * different arguments, and a walker would have to guess. Adding a field without
 * adding it below only weakens the parity check for that field, which is a
 * quieter failure than the one a wrong guess produces.
 */
const sentences = (locale: (typeof CoachLanguages)[number]): ReadonlyArray<[string, string]> => {
  const copy = inviteCopy(locale)
  return [
    ["greeting.invites", copy.greeting.invites(COACH)],
    ["greeting.lead", copy.greeting.lead],
    ["greeting.intake", copy.greeting.intake],
    ["greeting.session", copy.greeting.session],
    ...Object.entries(copy.form).map(([key, value]): [string, string] => [`form.${key}`, value]),
    ["consent.eyebrow", copy.consent.eyebrow],
    ["consent.summary", copy.consent.summary({ name: "Марія", email: "m@e.io" })],
    ["consent.locked", copy.consent.locked],
    ["done.title", copy.done.title],
    ["done.remindersTo", copy.done.remindersTo("m@e.io")],
    ["done.wrongAddress", copy.done.wrongAddress],
    ["done.withoutSession", copy.done.withoutSession(COACH)],
    ["refusal.alreadyAccepted.title", copy.refusal.alreadyAccepted.title],
    ["refusal.alreadyAccepted.body", copy.refusal.alreadyAccepted.body],
    ["refusal.superseded.title", copy.refusal.superseded.title],
    ["refusal.superseded.body", copy.refusal.superseded.body(COACH)],
    ["refusal.expired.title", copy.refusal.expired.title],
    ["refusal.expired.body", copy.refusal.expired.body(COACH)],
    ["refusal.unknown.title", copy.refusal.unknown.title],
    ["refusal.unknown.body", copy.refusal.unknown.body],
    ["refusal.stale", copy.refusal.stale],
    ["refusal.yourCoach", copy.refusal.yourCoach],
    ["failure", copy.failure],
  ]
}

/**
 * The catalogue is resolved **not strict**, so a gap falls back to English
 * silently. This is what makes that visible — without it the fallback hides
 * exactly the failure it exists to soften.
 */
describe("invite copy", () => {
  it("says every word in all three languages", () => {
    for (const locale of CoachLanguages) {
      for (const [path, value] of sentences(locale)) {
        expect(value.trim().length, path).toBeGreaterThan(0)
      }
    }
  })

  it("translates them rather than falling back to English", () => {
    const reference = new Map(sentences("en"))

    for (const locale of CoachLanguages.filter((one) => one !== "en")) {
      for (const [path, value] of sentences(locale)) {
        // The placeholder in `form.emailPlaceholder` is an address, not a word,
        // and is the same in every language on purpose.
        if (path === "form.emailPlaceholder") continue
        expect(value, path).not.toBe(reference.get(path))
      }
    }
  })

  /**
   * The reason this catalogue exists rather than reusing `clientCopy`: every
   * sentence there about where things arrive says "here", meaning the Telegram
   * chat. On a web page handed to somebody who is by definition not on Telegram,
   * that is false.
   */
  it("promises delivery by email, never «here»", () => {
    for (const locale of CoachLanguages) {
      const copy = inviteCopy(locale)
      expect(copy.done.remindersTo("maria@example.com")).toContain("maria@example.com")
      expect(copy.refusal.alreadyAccepted.body).not.toMatch(/сюди|сюда|right here/i)
    }
  })

  /**
   * `docs/agents/product-copy.md`: "A person's name is interpolated only in the
   * nominative, and only into a slot where the nominative is grammatical. When a
   * sentence needs an oblique case, use a common noun («ваш коуч») and put the
   * name in the surrounding interface instead."
   *
   * «Попросите у …» is genitive, so ru and uk must not take the name — the
   * refusal screen shows it in the frame instead (`CoachBadge`). `en` inflects
   * nothing and keeps it. Without this the sentence reads «Попросите у Олена
   * Пшенична», which is the exact failure #222 spent a ticket removing.
   */
  it("keeps the coach's name out of oblique slots in ru and uk", () => {
    for (const locale of ["ru", "uk"] as const) {
      const refusal = inviteCopy(locale).refusal
      expect(refusal.superseded.body(COACH)).not.toContain(COACH)
      expect(refusal.expired.body(COACH)).not.toContain(COACH)
      expect(refusal.stale).not.toContain(COACH)
      // And the frame's own slot exists to carry it.
      expect(refusal.yourCoach.trim().length).toBeGreaterThan(0)
    }

    // English keeps the name in the sentence — it declines nothing.
    expect(inviteCopy("en").refusal.expired.body(COACH)).toContain(COACH)
  })

  /** The unknown refusal names neither the coach nor the workspace, in any language. */
  it("keeps the unknown refusal anonymous", () => {
    for (const locale of CoachLanguages) {
      const unknown = inviteCopy(locale).refusal.unknown
      expect(`${unknown.title} ${unknown.body}`).not.toContain(COACH)
      // Nor does it take a coach to render — it cannot name one by construction.
      expect(typeof unknown.body).toBe("string")
    }
  })
})
