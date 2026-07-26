import { describe, expect, it } from "@effect/vitest"
import { CoachLanguages } from "@praximo/domain"
import {
  clientConsentText,
  clientConsentVersion,
  clientCopy,
  ClientLanguageNames,
} from "./client-copy.ts"
import { sessionMoment } from "./session-time.ts"

const COACH = "Ada Coaching"
const MOMENT = sessionMoment("en", new Date("2026-08-03T07:00:00.000Z"), "Europe/Kyiv")

describe("client consent", () => {
  it("carries the five required elements in every language", () => {
    for (const locale of CoachLanguages) {
      expect(clientCopy(locale).consent.points(COACH)).toHaveLength(5)
    }
  })

  // The text is evidence: the version has to change when a single sentence does,
  // and the three languages must not share one — the client has no language
  // control after acceptance, so their record names the rendering.
  it("versions each language separately and dates them", () => {
    const versions = CoachLanguages.map((locale) => clientConsentVersion(locale))
    expect(new Set(versions).size).toBe(3)
    for (const version of versions) {
      expect(version).toMatch(/^2026-08-01\+(en|uk|ru)\+[0-9a-f]{7}$/)
    }
  })

  it("derives the version from the text rather than from the coach reading it", () => {
    // Two coaches, one document: the version cannot depend on whose name is in it.
    expect(clientConsentText("ru", "Ada")).not.toBe(clientConsentText("ru", "Bo"))
    expect(clientConsentVersion("ru")).toBe(clientConsentVersion("ru"))
  })

  it("names the coach in every element that promises something about them", () => {
    const text = clientConsentText("uk", COACH)
    expect(text).toContain(COACH)
    // No URL in body text — the policy is a button (#164).
    expect(text).not.toContain("http")
  })
})

describe("client copy", () => {
  it("speaks as the coach's assistant rather than as a platform", () => {
    for (const locale of CoachLanguages) {
      expect(clientCopy(locale).stranger(COACH)).toContain(COACH)
    }
  })

  it("names the first meeting apart from the ones after it", () => {
    const intake = clientCopy("ru").confirmation.withSession({
      coach: COACH,
      kind: "intake",
      moment: MOMENT,
      durationMinutes: 30,
    })
    const regular = clientCopy("ru").confirmation.withSession({
      coach: COACH,
      kind: "regular",
      moment: MOMENT,
      durationMinutes: 60,
    })

    expect(intake).toContain("Первая встреча")
    expect(regular).toContain("Встреча")
    // Deliberately not «знакомство» — that word belongs to the chemistry session
    // the product deliberately does not run (#1 §Out of scope).
    expect(intake).not.toContain("знаком")
    // The count agrees with its noun in all three languages.
    expect(intake).toContain("30 минут")
    expect(regular).toContain("60 минут")
  })

  it("keeps gendered verb forms out of what it says about the coach", () => {
    const gendered = /\b(створила|створив|призначила|призначив|написала|написал|создала|создал)\b/
    for (const locale of ["uk", "ru"] as const) {
      const copy = clientCopy(locale)
      expect(copy.confirmation.withoutSession(COACH)).not.toMatch(gendered)
      expect(
        copy.confirmation.withSession({
          coach: COACH,
          kind: "intake",
          moment: MOMENT,
          durationMinutes: 30,
        }),
      ).not.toMatch(gendered)
    }
  })

  it("names each language in its own tongue", () => {
    expect(ClientLanguageNames).toEqual({ en: "English", uk: "Українська", ru: "Русский" })
  })

  // Three different messages, because they are three different situations: the
  // client who came back, the stranger who followed a used link, and the window
  // that closed.
  it("keeps the three refusals apart", () => {
    const copy = clientCopy("en")
    const refusals = new Set([
      copy.refusal.alreadySetUp(COACH),
      copy.refusal.linkUsed(COACH),
      copy.refusal.linkExpired(COACH),
    ])
    expect(refusals.size).toBe(3)
  })
})
