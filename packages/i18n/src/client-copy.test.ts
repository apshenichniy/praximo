import { describe, expect, it } from "@effect/vitest"
import { type CoachLanguage, CoachLanguages } from "@praximo/domain"
import {
  clientConsentText,
  clientConsentVersion,
  clientConsentVersions,
  clientCopy,
  ClientLanguageNames,
} from "./client-copy.ts"
import { sessionMoment } from "./session-time.ts"

const COACH = "Ada Coaching"
/** The two that inflect, and so the two every rule about case is about. */
const Inflected = ["uk", "ru"] as const
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

  /**
   * Pinned, because the version *is* the record: an edit that moves it has to be
   * a deliberate one somebody wrote down, not a digest that quietly drifted.
   *
   * Moved twice now. #222 reworded uk and ru; #57 took the `<b>` out of
   * `consent.title`, which is inside the versioned text, so that one moved all
   * three — including `en`, which #222 had left alone.
   */
  it("records the version each language carries today", () => {
    expect(clientConsentVersions()).toEqual({
      en: "2026-08-01+en+8325d38",
      uk: "2026-08-01+uk+d0eafe0",
      ru: "2026-08-01+ru+d68f379",
    })
  })

  /**
   * The reason the versions above moved, kept as a rule rather than a one-off.
   * Two surfaces render this block now and only the bot speaks HTML, so markup
   * in the catalogue is a literal `<b>` on the web page's consent screen — on
   * the one screen in the product where a stray tag is least affordable.
   */
  it("keeps markup out of the shared consent block", () => {
    for (const locale of CoachLanguages) {
      const consent = clientCopy(locale).consent
      const rendered = [
        consent.title,
        consent.lead(COACH),
        ...consent.points(COACH),
        consent.privacyButton,
        consent.agreeButton,
        consent.footer,
      ].join("\n")
      expect(rendered).not.toMatch(/<\/?[a-z]/i)
    }
  })
})

describe("client copy", () => {
  /** Every uk/ru sentence the coach's name left behind still says whose bot this is. */
  const obliqueSlots = (locale: CoachLanguage): ReadonlyArray<string | undefined> => {
    const copy = clientCopy(locale)
    return [
      copy.languageStep.lead(COACH),
      copy.invitation.message({ client: "Maria", coach: COACH }),
      copy.stranger(COACH),
      copy.consent.lead(COACH),
      copy.consent.points(COACH)[4],
      copy.refusal.alreadySetUp(COACH),
      copy.refusal.linkUsed(COACH),
      copy.refusal.linkExpired(COACH),
    ]
  }

  it("speaks as the coach's assistant rather than as a platform", () => {
    expect(clientCopy("en").stranger(COACH)).toContain(COACH)
    for (const locale of Inflected) {
      expect(clientCopy(locale).stranger(COACH)).toContain("коуч")
    }
  })

  /**
   * The name is an operator-entered label in the nominative, so uk and ru cannot
   * put it in a slot that wants genitive or dative (#193 Q1–Q2). The running
   * text says «ваш коуч» instead, and whose bot this is comes from the
   * surrounding surface — a chat titled with the coach's workspace name, or the
   * coach's own conversation, where they pasted the invitation themselves.
   */
  it("keeps the coach's name out of the slots that would need an oblique case", () => {
    for (const locale of Inflected) {
      for (const line of obliqueSlots(locale)) {
        expect(line).not.toContain(COACH)
        expect(line).toMatch(/коуч/)
      }
    }
  })

  // The rule is about case, not about the name: English inflects nothing, so the
  // same eight slots still carry it.
  it("leaves the English catalogue naming the coach throughout", () => {
    for (const line of obliqueSlots("en")) {
      expect(line).toContain(COACH)
    }
  })

  // The other half of the rule: where the nominative *is* grammatical, the name
  // stays, and these three slots are why the consent text still names the coach.
  it("still names the coach wherever the nominative is grammatical", () => {
    for (const locale of CoachLanguages) {
      const copy = clientCopy(locale)
      expect(copy.consent.points(COACH)[1]).toContain(COACH)
      expect(copy.consent.points(COACH)[2]).toContain(COACH)
      expect(copy.confirmation.withoutSession(COACH)).toContain(COACH)
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
    for (const locale of Inflected) {
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
      // «коуч» is grammatically masculine and takes no agreement from the
      // speaker, which is exactly why #222 could substitute it — so the sentences
      // it moved into must not reintroduce agreement through a past tense (#16).
      for (const line of obliqueSlots(locale)) expect(line).not.toMatch(gendered)
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
