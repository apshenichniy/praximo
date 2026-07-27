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

/** Where the shared controls live, and the only directory the third case reads. */
const UiDirectory = `${path.join("components", "ui")}${path.sep}`

/**
 * Base UI primitives whose whole job is one value in a set replacing another.
 *
 * Named rather than derived, because for a pass-through wrapper the import path
 * is the only thing that gives it away: a shadcn component typically takes
 * `Root.Props` and spreads them, so a checkbox that never writes the word
 * `onCheckedChange` anywhere still owes a tick.
 *
 * Disclosure primitives are deliberately absent — a drawer or a popover opening
 * is punctuation, `impactHaptic`, the other half of §Motion. So are `slider` and
 * `tabs`: one is a continuous drag and the other is closer to navigation, and
 * neither is settled enough to fail a build over. Add them here on the day the
 * app has one and has decided.
 */
const SelectionPrimitives = [
  "checkbox",
  "checkbox-group",
  "radio",
  "radio-group",
  "select",
  "switch",
  "toggle",
  "toggle-group",
] as const

/**
 * The other half of the signal: a change a component wraps by hand.
 *
 * `onValueChange` is here alongside the two boolean ones because a group root
 * reports its selection that way, and a group is the shape this whole case
 * exists for.
 */
const SelectionHandler = /\bon(Pressed|Checked|Value)Change\b/

/**
 * The call, not the name. The two cases above match the bare word, which is
 * enough for a screen — a screen that imports this has nothing else to do with
 * it. A control does: `Toggle` re-exports `toggleVariants` to the group beside
 * it, so an import left behind by a deleted handler would keep this green while
 * the chips went quiet, which is the exact failure being tested for.
 */
const SelectionTick = /\bselectionHaptic\(/

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

  /**
   * The case above finds a chip row by the `aria-pressed` it writes, which is
   * why the language chips were silent from #56 to #188: they are
   * `ToggleGroupItem`s, and a Base UI primitive emits that attribute at runtime
   * rather than in anybody's source. Every screen using them read as compliant
   * because none of them said the word.
   *
   * So the invariant is asserted where it now actually lives. A control that
   * carries its own tick cannot be adopted silently, and a shadcn component
   * pulled fresh from the CLI — which is how the gap arrived the first time —
   * arrives as a red test instead of as a chip row nobody feels.
   */
  it("ticks inside the control, where no screen can leave it out", async () => {
    const controls = (await files()).filter(({ path: file }) => file.startsWith(UiDirectory))
    expect(controls.length).toBeGreaterThan(0)

    const selecting = controls.filter(
      ({ source }) =>
        SelectionHandler.test(source) ||
        // The closing quote matters: it is what keeps `toggle` from claiming
        // `toggle-group`, and `radio` from claiming `radio-group`.
        SelectionPrimitives.some((primitive) =>
          source.includes(`@base-ui/react/${primitive}"`),
        ),
    )
    // A rename of the directory, or of the primitives, must not quietly turn
    // this into a test that reads nothing and passes.
    expect(selecting.length).toBeGreaterThan(0)

    const silent = selecting
      .filter(({ source }) => !SelectionTick.test(source))
      .map(({ path: file }) => file)

    expect(silent).toEqual([])
  })
})
