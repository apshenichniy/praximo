import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const sourcePaths = [
  fileURLToPath(new URL("../features/mini-app/components/invite-copy-sheet.tsx", import.meta.url)),
  fileURLToPath(
    new URL(
      "../../../coach/src/features/mini-app/components/invite-copy-sheet.tsx",
      import.meta.url,
    ),
  ),
] as const
const readSources = () => Promise.all(sourcePaths.map((sourcePath) => readFile(sourcePath, "utf8")))

/**
 * Telegram iOS can deny clipboard access after the invite mutation resolves.
 * The complete fallback message is much taller than a phone, so it must never
 * participate in the drawer's intrinsic height: the message scrolls while the
 * retry action stays in the drawer footer.
 */
describe("invite copy fallback layout", () => {
  it("grows to two thirds only when the long fallback appears in both role surfaces", async () => {
    const sources = await readSources()
    for (const source of sources) {
      expect(source).toContain('fallbackMessage !== undefined && "h-[66.6667dvh]"')
      expect(source).not.toContain("Automatic copy was blocked")
    }
  })

  it("keeps the Copy action outside the scrollable long message in both role surfaces", async () => {
    const sources = await readSources()
    for (const source of sources) {
      expect(source).toContain("field-sizing-fixed overflow-y-auto overscroll-contain")
      expect(source).toMatch(/<Textarea[\s\S]*?<\/div>\s*<DrawerFooter/)
      expect(source).toMatch(/<DrawerFooter[\s\S]*?>\s*Copy\s*<\/Button>/)
    }
  })
})
