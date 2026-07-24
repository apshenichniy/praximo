import { defaultExclude, defineConfig } from "vitest/config"

// Root config for the top-level test commands (scripts:test, livekit:test).
// Git worktrees under .claude/worktrees/ contain full repo copies whose test
// files match the default include glob — exclude them so leftover worktrees
// don't break the run.
export default defineConfig({
  test: {
    exclude: [...defaultExclude, "**/.claude/**"],
  },
})
