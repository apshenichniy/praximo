import { describe, expect, it } from "vitest"

import { cn } from "@/lib/utils.ts"

const classes = (value: string): ReadonlyArray<string> => value.split(" ")

/**
 * The type scale is this app's own (#186, #198) — `--text-*` is reset to
 * `initial` and six named steps replace it — so tailwind-merge cannot recognise
 * a size by name the way it recognises Tailwind's own. Left unconfigured it reads
 * `text-emphasis` as a *colour*, puts it in the same group as `text-background`,
 * and drops whichever came first: a filled button written as
 * `bg-destructive text-background … text-emphasis` reached the DOM with no
 * colour at all and fell back to the inherited foreground.
 */
describe("cn", () => {
  it("keeps a size and a colour: they are not the same decision", () => {
    const merged = classes(cn("bg-destructive text-background h-13 text-emphasis font-semibold"))

    expect(merged).toContain("text-background")
    expect(merged).toContain("text-emphasis")
  })

  it("keeps them whichever order they arrive in", () => {
    expect(classes(cn("text-emphasis", "text-muted-foreground"))).toEqual([
      "text-emphasis",
      "text-muted-foreground",
    ])
    expect(classes(cn("text-muted-foreground", "text-emphasis"))).toEqual([
      "text-muted-foreground",
      "text-emphasis",
    ])
  })

  it("still lets a size replace a size", () => {
    for (const step of ["caption", "body", "emphasis", "heading", "title", "display"]) {
      expect(cn(`text-${step}`, "text-title")).toBe("text-title")
    }
  })

  it("still lets a colour replace a colour", () => {
    expect(cn("text-foreground", "text-background")).toBe("text-background")
    expect(cn("text-muted-foreground", "text-destructive")).toBe("text-destructive")
  })

  it("leaves the utilities that merely start with text- alone", () => {
    const merged = classes(cn("text-center text-pretty text-body text-foreground"))

    expect(merged).toEqual(["text-center", "text-pretty", "text-body", "text-foreground"])
  })
})
