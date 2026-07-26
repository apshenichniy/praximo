import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const sourceDir = fileURLToPath(new URL("..", import.meta.url))

/**
 * The two halves of §Motion that a screen can silently forget.
 *
 * Applying the contract screen by screen is a plan checked by memory, and the
 * gaps found doing it in #186 were not scattered — every silent outcome was in
 * the coach's half of the app, because that half was written before the rule
 * existed. The rule is worth having as a test precisely because the *next*
 * screen will be written the same way: from a copy of a screen that predates it.
 *
 * Neither check can tell a right haptic from a wrong one — that is what the
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
})
