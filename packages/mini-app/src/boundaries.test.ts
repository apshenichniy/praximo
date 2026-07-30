import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceRoot = join(packageRoot, "src")

const sourceFiles = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : []
  })

describe("@praximo/mini-app boundaries", () => {
  it("keeps TanStack request middleware behind its explicit subpath", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      readonly exports: Readonly<Record<string, string>>
    }
    const root = readFileSync(join(sourceRoot, "index.ts"), "utf8")

    expect(manifest.exports).toEqual({
      ".": "./src/index.ts",
      "./launch-credential": "./src/launch-credential.ts",
    })
    expect(root).not.toContain("launch-credential.ts")
    expect(root).not.toContain("@tanstack/react-start")
  })

  it("imports no application router, query, or business/domain feature", () => {
    for (const file of sourceFiles(sourceRoot)) {
      const source = readFileSync(file, "utf8")
      expect(source, file).not.toContain("@tanstack/react-router")
      expect(source, file).not.toContain("@tanstack/react-query")
      expect(source, file).not.toContain("@praximo/domain")
      expect(source, file).not.toMatch(/from\s+["']@\/|from\s+["']apps\//)
    }
  })
})
