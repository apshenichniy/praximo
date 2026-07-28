import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const featuresDir = fileURLToPath(new URL("../features", import.meta.url))

/**
 * Features every other feature may reach into.
 *
 * `mini-app` holds the surface primitives — the section, the detail card, the
 * danger zone, the confirmation gate (#167). It is shared by construction, and
 * it is what a feature is supposed to depend on instead of depending on a
 * sibling. `i18n` holds the coach catalogue for the same reason.
 */
const Shared = new Set(["mini-app", "i18n"])

/**
 * Edges that exist and are not shared infrastructure, each one a deliberate
 * decision rather than a habit.
 *
 * The list is the point: an edge that is not here fails this test, and adding it
 * is a line in a review rather than an import somebody did not notice.
 */
const Allowed = new Set<string>([
  // Empty since #191. The one edge that used to be here — `coach -> legal`, the
  // onboarding terms screen reaching for the texts it summarises and the version
  // it is accepting — is gone because the texts are no longer in this app: they
  // moved to `@praximo/i18n`, where the surface that shows a contract and the
  // surface that records agreeing to it can both reach them.
])

const sourceFiles = async (dir: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
}

/** `@/features/<name>/…` — every feature a file reaches into. */
const importedFeatures = (source: string): ReadonlyArray<string> =>
  [...source.matchAll(/from\s+"@\/features\/([a-z0-9-]+)\//g)].flatMap((match) => match[1] ?? [])

/** The feature a file belongs to — the first segment under `features/`. */
const owningFeature = (file: string): string =>
  path.relative(featuresDir, file).split(path.sep)[0] ?? ""

describe("feature boundaries", () => {
  it("keeps every cross-feature import to the declared set", async () => {
    const files = await sourceFiles(featuresDir)
    expect(files.length).toBeGreaterThan(0)

    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")))

    const edges = new Set<string>()
    for (const [index, source] of sources.entries()) {
      const from = owningFeature(files[index] ?? "")
      for (const to of importedFeatures(source)) {
        if (to === from || Shared.has(to)) continue
        edges.add(`${from} -> ${to}`)
      }
    }

    expect(edges).toEqual(Allowed)
  })

  /**
   * The one edge the whole move exists to prevent (#167).
   *
   * The primitives were written for the admin section and now belong to the Mini
   * App surface. An import pointing back would make the app's first cross-feature
   * dependency the one hardest to unpick, and would say that the admin section
   * owns the app's layout vocabulary. It does not.
   */
  it("never lets the shared primitives depend on the admin feature", async () => {
    const files = await sourceFiles(path.join(featuresDir, "mini-app"))
    expect(files.length).toBeGreaterThan(0)

    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")))

    for (const [index, source] of sources.entries()) {
      const reached = importedFeatures(source)
      expect(
        reached.filter((feature) => feature !== "mini-app"),
        files[index],
      ).toEqual([])
    }
  })
})
