import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const sourcePath = fileURLToPath(
  new URL("../features/mini-app/components/invite-copy-sheet.tsx", import.meta.url),
)

/**
 * Telegram iOS can deny clipboard access after the invite mutation resolves.
 * The complete fallback message is much taller than a phone, so it must never
 * participate in the drawer's intrinsic height: the message scrolls while the
 * retry action stays in the drawer footer.
 */
describe("invite copy fallback layout", () => {
  it("keeps the Copy action outside the scrollable long message", async () => {
    const source = await readFile(sourcePath, "utf8")

    expect(source).toContain("field-sizing-fixed overflow-y-auto overscroll-contain")
    expect(source).toMatch(/<Textarea[\s\S]*?<\/div>\s*<DrawerFooter/)
    expect(source).toMatch(/<DrawerFooter[\s\S]*?>\s*Copy\s*<\/Button>/)
  })
})
