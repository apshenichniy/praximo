import { appendFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * The database a CI run tests against (#136): an ephemeral, schema-only Neon
 * branch of the existing project, created before `bun run test` and deleted
 * after it whatever the outcome. ADR 0003 already makes branch-per-stage the
 * norm and lists `NEON_API_KEY` as a CI secret; this is the same idea per run.
 *
 * Why a real Neon branch rather than a Postgres container: the repository layer
 * runs on the **neon-http** driver, which has no interactive transactions — the
 * CTE style throughout `packages/db` exists because of that. A plain-Postgres
 * runner would quietly make interactive transactions work and let CI pass code
 * that cannot run in a Worker.
 *
 * The pure halves below (request shapes, response parsing, the staleness rule)
 * are unit-tested with no network; the `main` at the bottom supplies the env,
 * performs the calls, and exports the URI to the rest of the job.
 */

export const NEON_API_BASE = "https://console.neon.tech/api/v2"

/** Every branch this script creates carries the prefix; `prune` reaps only these. */
export const CI_BRANCH_PREFIX = "ci-run-"

export interface NeonRequest {
  readonly method: "GET" | "POST" | "DELETE"
  readonly url: string
  readonly body?: unknown
}

/**
 * Named after the run, not the PR: a re-run of the same workflow gets its own
 * branch (the attempt is part of the name), so a retry never collides with the
 * branch its previous attempt is still deleting.
 */
export const ciBranchName = (run: {
  readonly runId: string
  readonly runAttempt: string
}): string => `${CI_BRANCH_PREFIX}${run.runId}-${run.runAttempt}`

const requireProjectId = (projectId: string): string => {
  if (projectId === "") {
    throw new Error(
      "missing Neon project id — set the NEON_PROJECT_ID repository variable (the project the dev branch lives in)",
    )
  }
  return projectId
}

/**
 * `init_source: "schema-only"` is the point: CI needs a migrated schema, never
 * the parent branch's rows, and `db:reset` drops and replays the migrations from
 * this checkout anyway. No `parent_id`, so the branch is taken from the project
 * default — which of the two it comes off makes no difference to a branch whose
 * schema is about to be dropped.
 */
export const createBranchRequest = (input: {
  readonly projectId: string
  readonly name: string
}): NeonRequest => ({
  method: "POST",
  url: `${NEON_API_BASE}/projects/${requireProjectId(input.projectId)}/branches`,
  body: {
    branch: { name: input.name, init_source: "schema-only" },
    // No endpoint means no compute and no connection URI to hand the suites.
    endpoints: [{ type: "read_write" }],
  },
})

export const branchStateRequest = (input: {
  readonly projectId: string
  readonly branchId: string
}): NeonRequest => ({
  method: "GET",
  url: `${NEON_API_BASE}/projects/${requireProjectId(input.projectId)}/branches/${requireBranchId(input.branchId)}`,
})

export const listBranchesRequest = (input: { readonly projectId: string }): NeonRequest => ({
  method: "GET",
  url: `${NEON_API_BASE}/projects/${requireProjectId(input.projectId)}/branches`,
})

const requireBranchId = (branchId: string): string => {
  if (branchId === "") {
    throw new Error("missing Neon branch id")
  }
  return branchId
}

export const deleteBranchRequest = (input: {
  readonly projectId: string
  readonly branchId: string
}): NeonRequest => ({
  method: "DELETE",
  url: `${NEON_API_BASE}/projects/${requireProjectId(input.projectId)}/branches/${requireBranchId(input.branchId)}`,
})

export interface CreatedBranch {
  readonly branchId: string
  readonly connectionUri: string
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

/**
 * Both fields are mandatory: without the URI the suites would fall back to
 * skipping, and without the id the cleanup step would leave the branch behind.
 */
export const parseCreateBranchResponse = (payload: unknown): CreatedBranch => {
  const response = asRecord(payload)
  const branchId = asRecord(response["branch"])["id"]
  const [firstUri] = Array.isArray(response["connection_uris"]) ? response["connection_uris"] : []
  const connectionUri = asRecord(firstUri)["connection_uri"]

  if (typeof branchId !== "string" || branchId === "") {
    throw new Error("Neon create-branch response carried no branch id")
  }
  if (typeof connectionUri !== "string" || connectionUri === "") {
    throw new Error("Neon create-branch response carried no connection URI for the new branch")
  }

  return { branchId, connectionUri }
}

export const parseBranchState = (payload: unknown): string => {
  const state = asRecord(asRecord(payload)["branch"])["current_state"]
  if (typeof state !== "string" || state === "") {
    throw new Error("Neon branch response carried no branch state")
  }
  return state
}

export const isBranchReady = (state: string): boolean => state === "ready"

export interface NeonBranchSummary {
  readonly id: string
  readonly name: string
  readonly created_at?: string | undefined
}

/**
 * A cancelled run can die between creating a branch and deleting it, so every
 * run reaps the leftovers first. Scoped to the CI prefix and to branches old
 * enough that no live run could still be using one — this must never be able to
 * delete the dev branch.
 */
export const staleCiBranches = (
  branches: ReadonlyArray<NeonBranchSummary>,
  options: { readonly now: Date; readonly maxAgeMs: number },
): ReadonlyArray<{ readonly id: string; readonly name: string }> =>
  branches
    .filter((branch) => {
      if (!branch.name.startsWith(CI_BRANCH_PREFIX)) return false
      if (branch.created_at === undefined) return false
      const createdAt = Date.parse(branch.created_at)
      if (Number.isNaN(createdAt)) return false
      return options.now.getTime() - createdAt > options.maxAgeMs
    })
    .map((branch) => ({ id: branch.id, name: branch.name }))

/** Branches this old cannot belong to a live run — the whole job times out in minutes. */
export const STALE_BRANCH_MAX_AGE_MS = 3 * 60 * 60 * 1000

const requireEnv = (name: string, hint: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`missing ${name} — ${hint}`)
  }
  return value
}

const callNeon = async (request: NeonRequest, apiKey: string): Promise<unknown> => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  })

  if (!response.ok) {
    // The body is Neon's error message; it carries no credential of ours.
    throw new Error(
      `Neon ${request.method} ${new URL(request.url).pathname} failed: ${response.status} ${await response.text()}`,
    )
  }
  return response.json()
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A fresh branch reports `init` for a few seconds; connecting before `ready` fails. */
const awaitBranchReady = async (
  branch: { readonly projectId: string; readonly branchId: string },
  apiKey: string,
): Promise<void> => {
  const deadline = Date.now() + 120_000
  for (;;) {
    const state = parseBranchState(await callNeon(branchStateRequest(branch), apiKey))
    if (isBranchReady(state)) return
    if (Date.now() > deadline) {
      throw new Error(`Neon branch ${branch.branchId} was still "${state}" after 120s`)
    }
    await sleep(2_000)
  }
}

const appendGithubFile = (variable: string, line: string): void => {
  const path = process.env[variable]
  if (path) appendFileSync(path, `${line}\n`)
}

const reapStaleBranches = async (projectId: string, apiKey: string): Promise<void> => {
  const payload = asRecord(await callNeon(listBranchesRequest({ projectId }), apiKey))
  const branches = Array.isArray(payload["branches"])
    ? (payload["branches"] as ReadonlyArray<NeonBranchSummary>)
    : []
  const stale = staleCiBranches(branches, {
    now: new Date(),
    maxAgeMs: STALE_BRANCH_MAX_AGE_MS,
  })

  for (const branch of stale) {
    console.log(`ci-neon-branch — reaping stale ${branch.name} (${branch.id})`)
    await callNeon(deleteBranchRequest({ projectId, branchId: branch.id }), apiKey)
  }
}

export type CiNeonBranchMode = "create" | "delete" | "prune"

export const parseMode = (args: ReadonlyArray<string>): CiNeonBranchMode => {
  const [mode] = args
  if (mode === "create" || mode === "delete" || mode === "prune") return mode
  throw new Error(
    `usage: bun scripts/ci-neon-branch.ts <create|delete|prune> (got: ${args.join(" ")})`,
  )
}

const main = async (): Promise<void> => {
  const mode = parseMode(process.argv.slice(2))
  const apiKey = requireEnv(
    "NEON_API_KEY",
    "CI cannot provision the database the @praximo/db suites need (#136). A pull request from a fork " +
      "cannot read repository secrets; run the workflow from a branch in this repository.",
  )
  const projectId = requireEnv(
    "NEON_PROJECT_ID",
    "set the repository variable to the Neon project the dev branch lives in",
  )

  if (mode === "prune") {
    await reapStaleBranches(projectId, apiKey)
    return
  }

  if (mode === "delete") {
    const branchId = requireEnv("NEON_BRANCH_ID", "the branch id the create step exported")
    await callNeon(deleteBranchRequest({ projectId, branchId }), apiKey)
    console.log(`ci-neon-branch — deleted ${branchId}`)
    return
  }

  const name = ciBranchName({
    runId: requireEnv("GITHUB_RUN_ID", "this script provisions branches for GitHub Actions runs"),
    runAttempt: process.env["GITHUB_RUN_ATTEMPT"] ?? "1",
  })
  const created = parseCreateBranchResponse(
    await callNeon(createBranchRequest({ projectId, name }), apiKey),
  )

  // Export the id *before* waiting: the cleanup step keys off this output, and a
  // run cancelled during the readiness poll would otherwise leave a live branch
  // that only the 3-hour prune reclaims.
  appendGithubFile("GITHUB_OUTPUT", `branch_id=${created.branchId}`)

  await awaitBranchReady({ projectId, branchId: created.branchId }, apiKey)

  // Mask before exporting: the URI carries the branch role's password, and the
  // steps that follow print their own command lines.
  console.log(`::add-mask::${created.connectionUri}`)
  appendGithubFile("GITHUB_ENV", `DATABASE_URL=${created.connectionUri}`)
  console.log(`ci-neon-branch — created ${name} (${created.branchId}), schema-only, ready`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
