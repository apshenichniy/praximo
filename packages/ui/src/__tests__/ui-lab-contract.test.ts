import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> }
const rootPackageJson = JSON.parse(
  readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> }
const lab = readFileSync(new URL("../lab/app.tsx", import.meta.url), "utf8")
const labStyles = readFileSync(new URL("../lab/ui-lab.css", import.meta.url), "utf8")

describe("UI Lab contract", () => {
  it("has independent root and package commands", () => {
    expect(packageJson.scripts?.dev).toContain("vite")
    expect(rootPackageJson.scripts?.["ui:dev"]).toContain("@praximo/ui")
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
      "Light",
      "Dark",
    ]) {
      expect(lab).toContain(evidence)
    }
  })

  it("mirrors production reduced-motion behavior in forced inspection mode", () => {
    expect(labStyles).toMatch(
      /\.reduce-motion \[data-slot="drawer-overlay"\],\s*\.reduce-motion \[data-slot="drawer-popup"\],\s*\.reduce-motion \[data-slot="toast"\]\s*{\s*transition-duration: 0\.01ms !important;\s*}/s,
    )
    expect(labStyles).toMatch(
      /\.reduce-motion button,\s*\.reduce-motion \[data-slot="toggle"\]\s*{\s*transform: none !important;\s*}/s,
    )
    expect(labStyles).toMatch(
      /\.reduce-motion \[data-slot="button"\],\s*\.reduce-motion \[data-slot="toggle"\],\s*\.reduce-motion \[data-slot="toast-content"\]\s*{\s*transition-duration: 100ms !important;\s*}/s,
    )
    expect(labStyles).not.toMatch(/\.reduce-motion \*::after\s*{[^}]*transition-duration:/s)
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
