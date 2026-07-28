import { describe, expect, it } from "vitest"
import { planDeploy, ProdConfirmationFlag, resolveDeployStage } from "./deploy.ts"

describe("the deploy command", () => {
  it("resolves the stage the way every other stage-bearing script does", () => {
    // ADR 0003: `--stage` wins, then `APP_STAGE`, then the personal default. The
    // middle one is the point of resolving at all — the Alchemy CLI only knows
    // about `USER`, so a deploy that ignored `APP_STAGE` could target a different
    // stage from the `db:reset` that just ran against it.
    expect(
      resolveDeployStage(["--stage", "dev_other"], { APP_STAGE: "dev_env", USER: "ada" }),
    ).toBe("dev_other")
    expect(resolveDeployStage([], { APP_STAGE: "dev_env", USER: "ada" })).toBe("dev_env")
    expect(resolveDeployStage([], { USER: "ada" })).toBe("dev_ada")
  })

  it("refuses a stage name this project does not have", () => {
    // `staging` is the name an operator reaches for and the one stage that does
    // not exist: the canonical dev stage is `dev_apshenichniy`, which is what
    // the canonical development domains are bound to.
    expect(() => resolveDeployStage(["--stage", "staging"], { USER: "ada" })).toThrow(/dev_<name>/)
    expect(() => resolveDeployStage(["--stage"], { USER: "ada" })).toThrow(/--stage <name>/)
    expect(() => resolveDeployStage([], {})).toThrow(/cannot resolve stage/)
  })

  it("will not deploy prod by default, and says why", () => {
    expect(() => planDeploy(["--stage", "prod"], { USER: "ada" })).toThrow(/full prod release/)
    expect(() => planDeploy([], { APP_STAGE: "prod", USER: "ada" })).toThrow(
      new RegExp(ProdConfirmationFlag),
    )
    expect(planDeploy(["--stage", "prod", ProdConfirmationFlag], { USER: "ada" }).args).toEqual([
      "alchemy",
      "deploy",
      "--stage",
      "prod",
      "--yes",
    ])
  })

  it("forwards the flags that belong to the Alchemy CLI", () => {
    // `--dry-run` is how a deploy is rehearsed and `--adopt` is what the first
    // root-stack deploy needs (ADR 0003 §Verification and adoption); neither is
    // this script's business to interpret.
    expect(planDeploy(["--dry-run", "--adopt"], { USER: "ada" })).toEqual({
      stage: "dev_ada",
      args: ["alchemy", "deploy", "--stage", "dev_ada", "--yes", "--dry-run", "--adopt"],
    })
    // The consumed ones do not reach it twice.
    expect(
      planDeploy(["--stage", "dev_ada", ProdConfirmationFlag, "--force"], { USER: "ada" }).args,
    ).toEqual(["alchemy", "deploy", "--stage", "dev_ada", "--yes", "--force"])
  })
})
