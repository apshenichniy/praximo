import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const repositoryRoot = join(import.meta.dirname, "..")
const read = (path: string) => readFileSync(join(repositoryRoot, path), "utf8")
const hasFiles = (path: string): boolean => {
  const absolute = join(repositoryRoot, path)
  if (!existsSync(absolute)) return false
  return readdirSync(absolute, { recursive: true, withFileTypes: true }).some((entry) =>
    entry.isFile(),
  )
}
const packageJson = (app: string) =>
  JSON.parse(read(`apps/${app}/package.json`)) as {
    readonly name: string
    readonly scripts: { readonly dev: string }
    readonly dependencies: Readonly<Record<string, string>>
  }

describe("application topology", () => {
  it("physically separates the four product surfaces", () => {
    expect(existsSync(join(repositoryRoot, "apps/web"))).toBe(false)
    expect(packageJson("admin").name).toBe("@praximo/admin")
    expect(packageJson("coach").name).toBe("@praximo/coach")
    expect(packageJson("client").name).toBe("@praximo/client")
    expect(packageJson("www").name).toBe("@praximo/www")
  })

  it("keeps each app on its local workflow port", () => {
    expect(packageJson("admin").scripts.dev).toContain("3000")
    expect(packageJson("coach").scripts.dev).toContain("3001")
    expect(packageJson("client").scripts.dev).toContain("3002")
    expect(packageJson("www").scripts.dev).toContain("3003")

    const root = JSON.parse(read("package.json")) as {
      readonly scripts: Readonly<Record<string, string>>
    }
    expect(root.scripts.dev).toContain("@praximo/admin")
    expect(root.scripts.dev).toContain("@praximo/coach")
    expect(root.scripts.dev).toContain("@praximo/client")
    expect(root.scripts.dev).toContain("@praximo/www")
  })

  it("leaves shared primitives with @praximo/ui", () => {
    for (const app of ["admin", "coach", "client", "www"]) {
      expect(packageJson(app).dependencies["@praximo/ui"]).toBe("workspace:*")
      expect(hasFiles(`apps/${app}/src/components/ui`)).toBe(false)
      expect(read(`apps/${app}/src/styles/app.css`)).toContain("@praximo/ui/styles.css")
    }
  })

  it("keeps Admin, Coach, and minimal Client product ownership disjoint", () => {
    expect(hasFiles("apps/admin/src/features/coach")).toBe(false)
    expect(hasFiles("apps/coach/src/features/admin")).toBe(false)

    const clientFiles = read("apps/client/src/routeTree.gen.ts")
    expect(clientFiles).not.toContain('"/i/$token"')
    expect(hasFiles("apps/client/src/features/conference")).toBe(false)
    expect(hasFiles("apps/client/src/features/acceptance")).toBe(false)
  })

  it("binds only the canonical single-environment domains", () => {
    const infrastructure = read("alchemy.run.ts")

    for (const domain of [
      "admin.praximo.io",
      "coach.praximo.io",
      "me.praximo.io",
      "stage.praximo.io",
    ]) {
      expect(infrastructure).toContain(domain)
    }
    expect(infrastructure).not.toMatch(
      /stage-admin\.praximo\.io|stage-coach\.praximo\.io|stage-me\.praximo\.io|my-stage\.praximo\.io/,
    )
    expect(infrastructure).not.toContain('domain: "praximo.io"')
  })
})
