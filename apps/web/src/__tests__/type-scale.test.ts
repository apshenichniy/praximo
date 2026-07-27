import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const sourceDir = fileURLToPath(new URL("..", import.meta.url))

/**
 * One type scale, and nothing outside it (docs/spec/mini-app.md §Typography).
 *
 * The app reached #186 with eight sizes crowded into the seven pixels between
 * 10 and 17, half of them written as one-off `text-[13px]`s, and the smallest
 * below what Apple's own smallest style uses. None of that was decided; it
 * accumulated. Tailwind's `--text-*` namespace is switched off in the theme, so
 * a size from outside the scale now silently renders at the inherited size
 * rather than failing — which is exactly the kind of drift a test has to catch
 * instead of a reviewer.
 *
 * A shadcn component pulled in fresh from the CLI is the likeliest source, and
 * this is what makes that arrive as a red test rather than as a paragraph that
 * looks a little off.
 */
const scale = ["caption", "body", "emphasis", "heading", "title", "display"] as const

/** Retired in #198, when `caption` moved to 13 and swallowed it. */
const merged = /\btext-footnote\b/g

/** Tailwind's own font-size utilities, which no longer exist here. */
const retired = /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/g

/** A size nobody put in the scale: `text-[13px]`, `text-[0.8rem]`. */
const arbitrary = /\btext-\[[0-9]/g

const sourceFiles = async (dir: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.endsWith("type-scale.test.ts"))
}

const offences = (source: string, pattern: RegExp): ReadonlyArray<string> => [
  ...new Set([...source.matchAll(pattern)].map(([match]) => match)),
]

describe("type scale", () => {
  it("is the only source of font sizes", async () => {
    const files = await sourceFiles(sourceDir)
    expect(files.length).toBeGreaterThan(0)

    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")))
    const found = files.flatMap((file, index) => {
      const source = sources[index] ?? ""
      const classes = [
        ...offences(source, retired),
        ...offences(source, arbitrary),
        ...offences(source, merged),
      ]
      return classes.length === 0 ? [] : [[path.relative(sourceDir, file), classes] as const]
    })

    expect(Object.fromEntries(found)).toEqual({})
  })

  it("keeps every step of the scale in use, so none is decoration", async () => {
    const files = await sourceFiles(sourceDir)
    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")))
    const app = sources.join("\n")

    for (const step of scale) {
      expect(app, `text-${step} is declared but unused`).toContain(`text-${step}`)
    }
  })
})
