import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const sourceDir = fileURLToPath(new URL("..", import.meta.url))

/**
 * The two halves of §Motion that a screen can silently forget, and the one place
 * a screen never gets the chance to.
 *
 * Applying the contract screen by screen is a plan checked by memory, and the
 * gaps found doing it in #186 were not scattered — every silent outcome was in
 * the coach's half of the app, because that half was written before the rule
 * existed. The rule is worth having as a test precisely because the *next*
 * screen will be written the same way: from a copy of a screen that predates it.
 *
 * No check here can tell a right haptic from a wrong one — that is what the
 * phone is for. They tell that something was said at all.
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

/**
 * The escape hatch, spelled out in the file that uses it: a hook can hand its
 * outcome out as a value for the screen to report, and `useInviteShare` does
 * exactly that because only the screen knows what «dismissed» means there.
 */
const DELEGATES = "haptics: reported by the caller"

describe("feedback invariants", () => {
  it("says how a mutation went", async () => {
    const silent = (await files())
      .filter(({ source }) => /\bacceptOnce\(|\buseMutation\(/.test(source))
      .filter(({ source }) => !source.includes("notifyHaptic") && !source.includes(DELEGATES))
      .map(({ path: file }) => file)

    expect(silent).toEqual([])
  })

  it("ticks when one value in a set replaces another", async () => {
    const silent = (await files())
      .filter(({ source }) => source.includes("aria-pressed"))
      .filter(({ source }) => !source.includes("selectionHaptic"))
      .map(({ path: file }) => file)

    expect(silent).toEqual([])
  })

  it("adapts shared control feedback to the presentation host", async () => {
    const root = await readFile(path.join(sourceDir, "routes", "__root.tsx"), "utf8")
    const host = await readFile(
      fileURLToPath(new URL("../../../../packages/mini-app/src/index.ts", import.meta.url)),
      "utf8",
    )

    expect(root).toContain("<FeedbackProvider adapter={presentationFeedback}>")
    expect(host).toContain("export const presentationFeedback")
    expect(host).toContain("selectionHaptic")
  })

  /**
   * Danger answers in one shape (#197).
   *
   * Deleting a workspace asked from a bottom sheet and deleting a client asked
   * from a centred dialog, which taught the coach nothing about either: the
   * decision moved to a different part of the screen depending on which decision
   * it was. A phone's thumb rests at the bottom, so the sheet is the shape that
   * won, and `ConfirmSheet` is where every confirmation goes.
   *
   * Asserted against the import rather than against a rendering, because the way
   * back is a `git revert` or an `AlertDialog` pulled fresh from the shadcn CLI —
   * both of which are an import appearing in a screen, and neither of which
   * looks wrong on the line it lands on.
   */
  it("asks a destructive question from the bottom of the screen", async () => {
    const dialogs = (await files())
      .filter(({ source }) => source.includes("components/ui/alert-dialog.tsx"))
      .map(({ path: file }) => file)

    expect(dialogs).toEqual([])
  })
})
