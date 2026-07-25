/**
 * The one gate every `@praximo/db` suite that needs a real Postgres opens with
 * (#136). Two things live here rather than being restated per test file:
 *
 * - the `DATABASE_URL` lookup, so the suites still skip on a machine without a
 *   provisioned branch (`bun run db:reset` provisions the dev one);
 * - the property that makes the skip safe: **in CI a missing `DATABASE_URL` is a
 *   failure, not a skip.** Until #136 the two were indistinguishable — 42 of the
 *   package's tests skipped on every PR and the job went green, so nothing the
 *   repository layer guarantees was actually being checked.
 *
 * CI provisions an ephemeral Neon branch per run (`scripts/ci-neon-branch.ts`)
 * and exports its URI, so reaching the throw below means that provisioning
 * broke — never that the suites are legitimately unrunnable.
 */

const databaseUrl = process.env.DATABASE_URL

/**
 * Keyed on `CI` (which GitHub Actions always sets) rather than on a flag the
 * workflow has to remember: a variable that must be present to enforce the rule
 * can be dropped from the workflow and put us straight back to silent skipping.
 * `REQUIRE_DATABASE_TESTS=0` is the deliberate opt-out.
 */
const databaseTestsRequired = Boolean(process.env.CI) && process.env.REQUIRE_DATABASE_TESTS !== "0"

const missingUrlExplanation =
  "@praximo/db database suites need DATABASE_URL — a migrated Postgres branch (`bun run db:reset`)."

if (databaseUrl === undefined || databaseUrl === "") {
  if (databaseTestsRequired) {
    throw new Error(
      `${missingUrlExplanation} CI must not skip them: a skipped database suite is indistinguishable ` +
        `from a passing one, which is the failure #136 exists to close. Check the "Create ephemeral ` +
        `Neon branch" step; set REQUIRE_DATABASE_TESTS=0 only to opt out on purpose.`,
    )
  }
  process.stderr.write(`\n!!  SKIPPED, NOT PASSED: ${missingUrlExplanation}\n\n`)
}

/** The gate itself: `describe.skipIf(skipWithoutDatabase)("… (Neon branch)", …)`. */
export const skipWithoutDatabase = databaseUrl === undefined || databaseUrl === ""

/**
 * The connection string for `Database.testLayer`. Empty when the suite is
 * skipped — `testLayer` is `Layer.sync`, so a skipped suite never resolves it.
 */
export const testDatabaseUrl = databaseUrl ?? ""
