import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MiniAppShell } from "@/components/mini-app-shell.tsx"

describe("Admin fullscreen wiring", () => {
  it("mounts the shared host adapter inside the Admin route frame", () => {
    const route = readFileSync(
      fileURLToPath(new URL("../routes/admin/route.tsx", import.meta.url)),
      "utf8",
    )
    expect(route).toContain("<HostFullscreen />")
  })

  it("pads the frame by the host's device and content safe-area insets", () => {
    const html = renderToStaticMarkup(
      <MiniAppShell>
        <span>content</span>
      </MiniAppShell>,
    )

    expect(html).toContain("--tg-safe-area-inset-top")
    expect(html).toContain("--tg-content-safe-area-inset-top")
  })
})
