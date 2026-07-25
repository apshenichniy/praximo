import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const dist = fileURLToPath(new URL("../../dist", import.meta.url))

const exists = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const scriptsUnder = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return scriptsUnder(path)
    return entry.name.endsWith(".js") ? [path] : []
  })

/**
 * The local credential minter must not survive into a deployed build.
 *
 * It is guarded by `import.meta.env.DEV`, which Vite folds to a constant — but
 * only where it is written as one. The guard that used to sit in front of the
 * runtime's dev branch was a *function call* taking that constant as an
 * argument, which is not foldable, and it kept the whole module in the server
 * bundle. That difference is invisible in review and invisible at runtime, so it
 * is asserted against the artifact instead.
 *
 * Skipped when nothing has been built; `bun run build` is what makes it real.
 */
describe.skipIf(!exists(dist))("production bundle", () => {
  it("carries no trace of the development credential minter", () => {
    const scripts = scriptsUnder(dist)
    expect(scripts.length).toBeGreaterThan(0)

    for (const script of scripts) {
      const source = readFileSync(script, "utf8")
      // The key generation, the signing, and the marker the minted launches
      // carry — none of them belong in a deployed Worker or in the browser.
      expect(source, script).not.toContain("praximo-local-development")
      expect(source, script).not.toContain("generateKey")
    }
  })
})
