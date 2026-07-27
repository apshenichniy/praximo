import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const sourceDir = fileURLToPath(new URL("..", import.meta.url))

/**
 * The Mini App's feedback contract, in the half of it that survives the crossing
 * (#191).
 *
 * `apps/web` asserts that a mutation reports its outcome and that a selection
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

/** Where the shared controls live. */
const UiDirectory = `${path.join("components", "ui")}${path.sep}`

/**
 * Base UI primitives whose whole job is one value in a set replacing another.
 * Named rather than derived, because a pass-through wrapper gives itself away
 * only by its import: a component that spreads `Root.Props` may never write the
 * word `onPressedChange` and still owe a visible selected state.
 */
const SelectionPrimitives = ["checkbox", "radio", "select", "switch", "toggle"] as const

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
  it("gives every selection control a state you can see", async () => {
    const controls = (await files()).filter(({ path: file }) => file.startsWith(UiDirectory))
    expect(controls.length).toBeGreaterThan(0)

    const selecting = controls.filter(({ source }) =>
      // The closing quote matters: it is what keeps `toggle` from claiming
      // `toggle-group`, and `radio` from claiming `radio-group`.
      SelectionPrimitives.some((primitive) => source.includes(`@base-ui/react/${primitive}"`)),
    )
    // A rename of the directory, or of the primitives, must not quietly turn
    // this into a test that reads nothing and passes.
    expect(selecting.length).toBeGreaterThan(0)

    const invisible = selecting
      .filter(({ source }) => !/\b(aria-pressed:|data-\[state=on\]:)/.test(source))
      .map(({ path: file }) => file)

    expect(invisible).toEqual([])
  })

  /**
   * Every control here is reachable by keyboard, which the Mini App's are not —
   * a Telegram webview is a thumb. So the ring is this app's own invariant, and
   * a primitive copied across from `apps/web` without it is the way it goes
   * missing.
   */
  it("keeps a visible focus ring on everything a keyboard can reach", async () => {
    const controls = (await files()).filter(
      ({ path: file, source }) =>
        file.startsWith(UiDirectory) && /@base-ui\/react\/(button|toggle)/.test(source),
    )
    expect(controls.length).toBeGreaterThan(0)

    const unfocusable = controls
      .filter(({ source }) => !source.includes("focus-visible:"))
      .map(({ path: file }) => file)

    expect(unfocusable).toEqual([])
  })
})
