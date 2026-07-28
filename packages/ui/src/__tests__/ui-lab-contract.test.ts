import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> }
const rootPackageJson = JSON.parse(
  readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> }
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8")
const lab = readFileSync(new URL("../lab/app.tsx", import.meta.url), "utf8")
const labStyles = readFileSync(new URL("../lab/ui-lab.css", import.meta.url), "utf8")

describe("UI Lab contract", () => {
  it("has independent root and package commands", () => {
    expect(packageJson.scripts?.dev).toContain("vite")
    expect(rootPackageJson.scripts?.["ui:dev"]).toContain("@praximo/ui")
  })

  it("uses the shared light and dark favicons", () => {
    expect(html).toContain("../../assets/branding/coach-bot/dark/favicon.ico")
    expect(html).toContain("../../assets/branding/coach-bot/light/favicon.ico")
  })

  it("owns interactive theme, motion, and status inspection", () => {
    for (const evidence of [
      "localStorage",
      "prefers-reduced-motion",
      "navigator.clipboard",
      "contrastRatio",
      "Reset colors",
      "Tailwind palette",
      "OKLCH",
      "primaryStorageKey",
      "Theme colors",
      "Pure shadcn",
      "Praximo extensions",
      "oklch(0.432 0.232 292.759)",
      "Light",
      "Dark",
    ]) {
      expect(lab).toContain(evidence)
    }
  })

  it("forces reduced motion only on the Praximo feedback wrapper", () => {
    expect(labStyles).toMatch(
      /\.reduce-motion \[data-praximo-feedback-button\]\s*{\s*transform: none !important;\s*transition-duration: 100ms !important;\s*}/s,
    )
    expect(lab).toContain("<FeedbackButton>")
  })

  it("renders every typography role with localization and layout stress cases", () => {
    for (const role of [
      "display",
      "page-title",
      "section-title",
      "card-title",
      "body",
      "body-small",
      "label",
      "caption",
    ]) {
      expect(lab).toContain(role)
    }

    for (const evidence of [
      "Cyrillic",
      "tabular-nums",
      "truncate",
      "Mobile",
      "Desktop",
      "Component recipes",
    ]) {
      expect(lab).toContain(evidence)
    }
  })
})
