import { describe, expect, it } from "@effect/vitest"
import { CoachLanguages } from "@praximo/domain"
import { makeCatalogue } from "@praximo/i18n"
import { botCatalog, CatalogueFile, type Copy, escapeHtml, messages } from "./messages.ts"

/**
 * The catalogue's two rules, pinned (#164). Both are invisible in review — a URL
 * pasted back into a body reads fine, and an unbalanced `<b>` is a message
 * Telegram refuses at *send* time, in production, to one coach.
 *
 * The structural parity checks are the third thing: three languages of the same
 * message are supposed to be the same message. A paragraph or an emoji that
 * exists in one of them and not the others is a translation that drifted, and
 * the drift always shows up first as a count.
 */

/** One argument covers every function in `Copy`: a name, or a bot username. */
const SAMPLE = "praximo_test_bot"

const render = (copy: Copy): ReadonlyArray<readonly [string, string]> =>
  Object.entries(copy).map(([key, value]) => [
    key,
    typeof value === "function" ? (value as (argument: string) => string)(SAMPLE) : value,
  ])

/** The pair that leaves through `ManagerBotSender.sendText`, which has no parse mode. */
const PlainText = new Set(["botRepaired", "botNeedsRelink"])

const AllowedTags = new Set(["b", "i", "code", "blockquote"])

/** Balance the tags in a string, so an unclosed `<b>` fails here and not at Telegram. */
const unbalancedTag = (text: string): string | undefined => {
  const stack: Array<string> = []
  for (const match of text.matchAll(/<(\/?)([a-z]+)(?: [a-z]+)?>/g)) {
    const [, closing, name = ""] = match
    if (!AllowedTags.has(name)) return `unknown tag <${name}>`
    if (closing === "/") {
      if (stack.pop() !== name) return `stray </${name}>`
      continue
    }
    stack.push(name)
  }
  return stack.length === 0 ? undefined : `unclosed <${stack[0]}>`
}

const emoji = (text: string): ReadonlyArray<string> =>
  text.match(/\p{Extended_Pictographic}|\d️⃣/gu) ?? []

describe("the coach-facing catalogue", () => {
  it.each(CoachLanguages)("carries no URL in any %s message", (language) => {
    for (const [key, text] of render(messages(language))) {
      expect(`${key}: ${text}`).not.toMatch(/https?:\/\//)
      // `t.me/…` without a scheme is the same message with the same problem.
      expect(`${key}: ${text}`).not.toMatch(/\bt\.me\//)
    }
  })

  it.each(CoachLanguages)("keeps %s HTML well-formed, and plain where it must be", (language) => {
    for (const [key, text] of render(messages(language))) {
      if (PlainText.has(key)) {
        // Sent through a channel with no `parse_mode`, so a tag here reaches the
        // coach as literal `<b>`.
        expect(`${key}: ${text}`).not.toMatch(/<[a-z/]/)
        continue
      }
      expect(`${key}: ${unbalancedTag(text) ?? "balanced"}`).toBe(`${key}: balanced`)
      // Telegram wants `&` escaped too, and it fails the *send* rather than the
      // build — so an author's stray ampersand would reach one coach, live.
      expect(`${key}: ${text}`).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/)
    }
  })

  it("keeps the three languages structurally identical", () => {
    const english = new Map(render(messages("en")))
    for (const language of CoachLanguages) {
      for (const [key, text] of render(messages(language))) {
        const reference = english.get(key) ?? ""
        expect(`${language}.${key} paragraphs: ${text.split("\n\n").length}`).toBe(
          `${language}.${key} paragraphs: ${reference.split("\n\n").length}`,
        )
        expect(`${language}.${key} emoji: ${emoji(text).join("")}`).toBe(
          `${language}.${key} emoji: ${emoji(reference).join("")}`,
        )
      }
    }
  })

  it.each(CoachLanguages)("escapes the workspace name it interpolates into %s", (language) => {
    const injected = messages(language).invitationReserved("<b>Ada</b> & Co")

    expect(injected).toContain("&lt;b&gt;Ada&lt;/b&gt; &amp; Co")
    expect(unbalancedTag(injected)).toBeUndefined()
  })

  it("escapes only what HTML reads", () => {
    expect(escapeHtml("a & b <c> d")).toBe("a &amp; b &lt;c&gt; d")
    expect(escapeHtml("Ada Coaching")).toBe("Ada Coaching")
  })

  /**
   * The strict half of the shared gap filling (#167). At runtime this Worker
   * falls back to English rather than throwing — a Worker has no development
   * build to fail in — so the failure has to happen here instead, before a blank
   * can be committed. Without it the fallback would quietly hide exactly the
   * mistake it exists to survive.
   */
  it("carries no gaps: every locale fills out against English with none left", () => {
    const strict = makeCatalogue<Copy>({
      reference: "en",
      byLocale: botCatalog,
      strict: true,
      where: CatalogueFile,
    })

    for (const language of CoachLanguages) {
      expect(() => strict(language), language).not.toThrow()
    }
  })
})
