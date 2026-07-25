import { defineConfig } from "vitest/config"

/**
 * These suites are not unit tests: every statement is an HTTP round trip to a
 * real Postgres (the neon-http driver, ADR 0003), and a fixture-heavy test makes
 * dozens of them. Vitest's 5s default is a unit-test budget — on a GitHub runner
 * talking to `aws-eu-central-1` it expired mid-test the first time CI actually
 * ran these (#143), on `workspace-deletion-repo`, which builds the largest
 * fixture in the package.
 *
 * 30s is sized to that latency, not to hide slowness: it still fails a genuinely
 * stuck query fast enough to matter, and no test here takes more than a couple
 * of seconds against a nearby branch. Scoped to this package for that reason —
 * everything else in the repository is CPU-bound and keeps the strict default.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
