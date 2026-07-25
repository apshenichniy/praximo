import { describe, expect, it } from "@effect/vitest"
import {
  CI_BRANCH_PREFIX,
  ciBranchName,
  createBranchRequest,
  defaultBranchId,
  deleteBranchRequest,
  isBranchReady,
  parseBranchState,
  parseCreateBranchResponse,
  staleCiBranches,
} from "./ci-neon-branch.ts"

// The pure half of the CI database provisioner, tested with no network and no
// env: the request shapes, the response parsing that must not hand a half-built
// branch to the suites, and the age rule that reaps branches a cancelled run
// left behind.

describe("ciBranchName", () => {
  it("names the branch after the run and attempt, under the CI prefix", () => {
    const name = ciBranchName({ runId: "42", runAttempt: "2" })
    expect(name).toBe(`${CI_BRANCH_PREFIX}42-2`)
    expect(name.startsWith(CI_BRANCH_PREFIX)).toBe(true)
  })

  it("keeps a re-run distinct from the attempt it retries", () => {
    expect(ciBranchName({ runId: "42", runAttempt: "1" })).not.toBe(
      ciBranchName({ runId: "42", runAttempt: "2" }),
    )
  })
})

describe("createBranchRequest", () => {
  it("asks for a schema-only child of the parent, with a read-write compute", () => {
    const request = createBranchRequest({
      projectId: "icy-sunset-1",
      name: "ci-run-42-1",
      parentId: "br-curly-forest",
    })

    expect(request.method).toBe("POST")
    expect(request.url).toBe("https://console.neon.tech/api/v2/projects/icy-sunset-1/branches")
    expect(request.body).toEqual({
      branch: {
        name: "ci-run-42-1",
        // schema-only: CI never needs — and must never copy — the parent's rows.
        init_source: "schema-only",
        // Never omitted: without a parent Neon makes a *root* branch, and the
        // project holds only a couple, so a second concurrent run is refused
        // with ROOT_BRANCHES_LIMIT_EXCEEDED before it can test anything (#143).
        parent_id: "br-curly-forest",
      },
      // Without an endpoint the branch has no compute and no connection URI.
      endpoints: [{ type: "read_write" }],
    })
  })

  it("rejects an empty project id rather than calling /projects//branches", () => {
    expect(() =>
      createBranchRequest({ projectId: "", name: "ci-run-42-1", parentId: "br-curly-forest" }),
    ).toThrow(/missing Neon project id/)
  })
})

describe("deleteBranchRequest", () => {
  it("targets the branch by id", () => {
    expect(
      deleteBranchRequest({ projectId: "icy-sunset-1", branchId: "br-small-thunder" }),
    ).toEqual({
      method: "DELETE",
      url: "https://console.neon.tech/api/v2/projects/icy-sunset-1/branches/br-small-thunder",
    })
  })

  it("rejects an empty branch id rather than issuing a DELETE on the branch collection", () => {
    expect(() => deleteBranchRequest({ projectId: "icy-sunset-1", branchId: "" })).toThrow(
      /missing Neon branch id/,
    )
  })
})

describe("parseCreateBranchResponse", () => {
  const response = {
    branch: { id: "br-small-thunder", name: "ci-run-42-1", current_state: "init" },
    connection_uris: [
      {
        connection_uri:
          "postgresql://neondb_owner:pw@ep-aged-frost.eu-central-1.aws.neon.tech/neondb?sslmode=require",
      },
    ],
  }

  it("takes the branch id and its connection URI", () => {
    expect(parseCreateBranchResponse(response)).toEqual({
      branchId: "br-small-thunder",
      connectionUri:
        "postgresql://neondb_owner:pw@ep-aged-frost.eu-central-1.aws.neon.tech/neondb?sslmode=require",
    })
  })

  it("fails when the branch came back without a connection URI", () => {
    expect(() => parseCreateBranchResponse({ branch: { id: "br-small-thunder" } })).toThrow(
      /no connection URI/,
    )
  })

  it("fails when the response carries no branch id", () => {
    expect(() => parseCreateBranchResponse({ connection_uris: [{ connection_uri: "x" }] })).toThrow(
      /no branch id/,
    )
  })
})

describe("parseBranchState", () => {
  it("reads the branch's current state", () => {
    expect(parseBranchState({ branch: { current_state: "ready" } })).toBe("ready")
    expect(isBranchReady("ready")).toBe(true)
    expect(isBranchReady("init")).toBe(false)
  })

  it("fails loudly rather than treating an unreadable response as ready", () => {
    expect(() => parseBranchState({})).toThrow(/no branch state/)
  })
})

describe("staleCiBranches", () => {
  const now = new Date("2026-07-25T12:00:00.000Z")
  const maxAgeMs = 3 * 60 * 60 * 1000

  it("reaps a CI branch older than the cutoff", () => {
    const stale = staleCiBranches(
      [{ id: "br-old", name: `${CI_BRANCH_PREFIX}1-1`, created_at: "2026-07-25T08:00:00.000Z" }],
      { now, maxAgeMs },
    )
    expect(stale).toEqual([{ id: "br-old", name: `${CI_BRANCH_PREFIX}1-1` }])
  })

  it("leaves a CI branch a concurrent run is still using", () => {
    expect(
      staleCiBranches(
        [
          {
            id: "br-running",
            name: `${CI_BRANCH_PREFIX}2-1`,
            created_at: "2026-07-25T11:50:00.000Z",
          },
        ],
        { now, maxAgeMs },
      ),
    ).toEqual([])
  })

  it("never touches a branch outside the CI prefix, however old", () => {
    expect(
      staleCiBranches(
        [
          { id: "br-main", name: "main", created_at: "2020-01-01T00:00:00.000Z" },
          {
            id: "br-dev",
            name: "Praximo-Branch-dev-apshenichniy-x",
            created_at: "2020-01-01T00:00:00.000Z",
          },
        ],
        { now, maxAgeMs },
      ),
    ).toEqual([])
  })

  it("skips entries it cannot date rather than guessing they are stale", () => {
    expect(
      staleCiBranches([{ id: "br-odd", name: `${CI_BRANCH_PREFIX}3-1` }], { now, maxAgeMs }),
    ).toEqual([])
  })
})

describe("defaultBranchId", () => {
  it("finds the branch Neon marks as the project default", () => {
    expect(
      defaultBranchId([
        { id: "br-dev", name: "Praximo-Branch-dev-apshenichniy-x" },
        { id: "br-main", name: "main", default: true },
      ]),
    ).toBe("br-main")
  })

  it("refuses to fall back to a parentless create, which would be a root branch", () => {
    expect(() => defaultBranchId([{ id: "br-dev", name: "dev" }])).toThrow(/no default branch/)
  })
})
