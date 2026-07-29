import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const sourceDir = fileURLToPath(new URL("..", import.meta.url))

/**
 * The Mini App's feedback contract, in the half of it that survives the crossing
 * (#191).
 *
 * Admin and Coach assert that a mutation reports its outcome and that a selection
 * ticks, both through Telegram's haptic bridge. **Neither is portable, and the
 * honest thing is to say so rather than to pass by pretending.** There is no
 * haptic channel in a browser: `navigator.vibrate` does not exist on iOS Safari,
 * which is where most readers of these pages are, and a tick that fires on half
 * the devices teaches a rule the app then breaks. Manufacturing a no-op module
 * so a ported test could go green would be writing code to satisfy a test rather
 * than to answer anybody.
 *
 * What does cross is the *shape* the contract is really about: a control that
 * can be chosen has to show that it was, and a destructive question is asked in
 * one place. Those are answered here in CSS and structure instead of in the
 * bridge, and they are what these two cases hold.
 */
const files = async (): Promise<ReadonlyArray<{ path: string; source: string }>> => {
  const entries = await readdir(sourceDir, { withFileTypes: true, recursive: true })
  const paths = entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !/\.test\.tsx?$/.test(file))
  return Promise.all(
    paths.map(async (file) => ({
      path: path.relative(sourceDir, file),
      source: await readFile(file, "utf8"),
    })),
  )
}

describe("feedback invariants", () => {
  /**
   * A control a reader can choose has to look chosen. On a phone the Mini App
   * answers this with a haptic *and* a fill; here the fill is the whole answer,
   * so it is the thing that may not go missing.
   *
   * `aria-pressed:` / `data-[state=on]:` are how that fill is expressed against
   * Base UI's own state attributes — a variant that styles neither is a control
   * whose selection is invisible, which is the failure this replaces the haptic
   * cases with.
   */
  it("uses the shared selection controls", async () => {
    const appearance = (await files()).find(({ path: file }) =>
      file.endsWith("components/appearance-menu.tsx"),
    )?.source

    // A menu, since the control moved into the frame of both shells and its
    // trigger became an icon. The invariant is unchanged and is why this is a
    // *radio* group: three answers, one always on, and the one that is on
    // carries the primitive's own indicator. Plain items would be three
    // commands with no state, which is the invisible-selection failure this
    // case exists to catch.
    expect(appearance).toContain("@praximo/ui/components/dropdown-menu")
    expect(appearance).toContain("DropdownMenuRadioItem")
    expect(appearance).toContain("value={preference}")
  })

  /**
   * Danger answers in one shape (#197, carried over).
   *
   * There is nothing destructive on these pages yet, so this reads as a guard
   * against a future rather than a check on a present — which is exactly what it
   * is, and why it is worth having now. The way an `AlertDialog` arrives is a
   * fresh pull from the shadcn CLI, and it looks perfectly reasonable on the line
   * it lands on. The rule is the same one the Mini App holds: a confirmation is
   * asked from the bottom of the screen, where a thumb already is.
   */
  it("asks a destructive question from the bottom of the screen", async () => {
    const dialogs = (await files())
      .filter(({ source }) => source.includes("components/ui/alert-dialog.tsx"))
      .map(({ path: file }) => file)

    expect(dialogs).toEqual([])
  })

  it("does not keep a private primitive directory", async () => {
    const privatePrimitives = (await files())
      .filter(({ path: file }) => file.startsWith("components/ui/"))
      .map(({ path: file }) => file)

    expect(privatePrimitives).toEqual([])
  })
})
