import { readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "@effect/vitest"

/**
 * The coach's language has exactly two writers, and this test is what keeps it
 * that way (#130).
 *
 * The column used to have one writer under the wrong owner — the create path's
 * `${input.coachLanguage ?? "en"}` — and an optional input nobody sent, so every
 * coach in production was English forever while three languages of copy went
 * unread. A second owner is what produced that, so the count is the invariant
 * worth pinning, not the behaviour of any one statement.
 *
 * It reads source rather than exercising a database on purpose: a third writer
 * is a thing somebody *writes*, and this fails on the pull request that adds it
 * whether or not that path has a test of its own. The whole repository is
 * scanned, not just this package — an app can reach the table through Drizzle
 * as easily as a repository can, and a rule enforced in one directory is a rule
 * that moves next door.
 */
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url))

/** Where product code lives. Everything else is fixtures, config, or docs. */
const scanned = ["apps", "packages"]

/**
 * `dev-seed.ts` is exempt: it fabricates whole members for a local demo — every
 * column at once, from a fixture — and never runs against production. Exempting
 * it is not a hole in the invariant, because it cannot change a real coach's
 * language; including it would only make the expected set a place where a real
 * writer could hide behind a familiar name.
 */
const exempt = new Set(["dev-seed.ts"])

/** A statement that writes the `member` table, in either dialect used here. */
const WRITE_SITE =
  /update\s+"member"|insert\s+into\s+"member"\s*\(|\.(?:update|insert)\(schema\.member\)/g

/**
 * How much of a statement to read when deciding whether it touches `language`.
 * Every write site in this repository sets its columns well inside this, and the
 * window ends at the statement's own error handler where one is closer.
 */
const STATEMENT_WINDOW = 1_400

const statementAt = (source: string, index: number): string => {
  const rest = source.slice(index, index + STATEMENT_WINDOW)
  const boundary = rest.indexOf("catch:")
  return boundary === -1 ? rest : rest.slice(0, boundary)
}

/**
 * Does this statement assign the `language` column, in SQL or through Drizzle?
 *
 * The Drizzle arm accepts a quote as well as a word character on purpose: a
 * literal — `.set({ language: "ru" })` — is exactly the shape a third writer
 * would take, and a pattern that only caught `language: input.language` would
 * wave it through.
 */
const writesLanguage = (statement: string): boolean =>
  /"language"\s*=/.test(statement) ||
  /^\s*"language",?\s*$/m.test(statement) ||
  /\blanguage:\s*["'\w]/.test(statement)

const sourceFiles = (directory: string): ReadonlyArray<string> => {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const path = `${directory}/${entry}`
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path))
      continue
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || exempt.has(entry)) continue
    found.push(path)
  }
  return found
}

const languageWriters = (): ReadonlyArray<string> => {
  const found: string[] = []
  for (const directory of scanned) {
    for (const path of sourceFiles(`${repositoryRoot}${directory}`)) {
      const source = readFileSync(path, "utf8")
      for (const match of source.matchAll(WRITE_SITE)) {
        if (writesLanguage(statementAt(source, match.index))) {
          const line = source.slice(0, match.index).split("\n").length
          found.push(`${path.slice(repositoryRoot.length)}:${line}`)
        }
      }
    }
  }
  return found
}

describe("member.language", () => {
  it("has exactly two writers: the invite claim and the coach's own choice", () => {
    const writers = languageWriters()

    // Named so a failure reads as "who else writes this now", not as a number.
    expect(writers).toEqual([
      // The claiming `/start`, seeding it from the sender's Telegram client…
      expect.stringContaining("packages/db/src/coach-bot-provisioning-repo.ts:"),
      // …and the coach choosing it for themselves during onboarding.
      expect.stringContaining("packages/db/src/member-repo.ts:"),
    ])
  })

  it("is not written by workspace creation", () => {
    const creation = readFileSync(
      `${repositoryRoot}packages/db/src/coach-onboarding-repo.ts`,
      "utf8",
    )
    const insert = creation.slice(creation.indexOf('insert into "member"'))

    expect(insert.slice(0, STATEMENT_WINDOW)).not.toMatch(/"language"/)
  })
})
