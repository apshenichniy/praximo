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
 * These suites run in one place only: CI's `database` job, which provisions an
 * ephemeral Neon branch (`scripts/ci-neon-branch.ts`) and exports its URI. So
 * reaching the throw below means that provisioning broke — never that the suites
 * are legitimately unrunnable.
 *
 * That job is conditional (a schema-only Neon branch is an independent root
 * branch, and one per pull-request commit exhausted the project's storage), but
 * the condition lives in the workflow, not here: `bun run test:no-db` leaves this
 * package out of the run entirely rather than letting it skip. The rule below
 * stays absolute — under `CI`, a suite that reaches this file without a database
 * is a failure.
 *
 * This is test support, not a config seam: ADR 0002 keeps packages from reading
 * the environment, and the seam the *runtime* resolves `DATABASE_URL` through is
 * still `Database.layer` over the app's ConfigProvider. Nothing here is exported
 * from `index.ts`.
 */

const databaseUrl = process.env.DATABASE_URL

/**
 * Keyed on `CI` (which GitHub Actions always sets) and nothing else. A flag the
 * workflow has to remember to pass could be dropped from it and put us straight
 * back to silent skipping, and an opt-out would reinstate exactly the failure
 * this closes — so there is neither.
 */
const databaseTestsRequired = Boolean(process.env.CI)

const missingUrlExplanation =
  "@praximo/db database suites need DATABASE_URL — a migrated Postgres branch (`bun run db:reset`)."

if (databaseUrl === undefined || databaseUrl === "") {
  if (databaseTestsRequired) {
    throw new Error(
      `${missingUrlExplanation} CI must not skip them: a skipped database suite is indistinguishable ` +
        `from a passing one, which is the failure #136 exists to close. Check the workflow's ` +
        `"Create this run's Neon branch" step — reaching this means its provisioning broke.`,
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
