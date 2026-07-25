import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

/**
 * `bun run deploy` — the deploy path [ADR 0003](../docs/adr/0003-alchemy-iac-structure.md)
 * §Deploy and state describes, as a script rather than as a line to remember.
 *
 * The Alchemy CLI already defaults `--stage` to `dev_${USER}` and reads the root
 * `.env`, so this wrapper exists for the three things it does not do:
 *
 * - **`CI=1`.** Without it Alchemy expects an interactive `alchemy login` and
 *   fails with `AuthError` even when the `.env` credentials are present (#32).
 *   Every non-interactive run needs it, so no run should have to remember it.
 * - **`APP_STAGE`.** `db:reset`, `branding:avatar:set` and the CI branch script
 *   all resolve their stage that way; a deploy that only honoured `USER` would
 *   quietly target a different stage from the reset that just ran against it.
 * - **A gate in front of `prod`.** ADR 0003 puts prod deploys in GitHub Actions on
 *   merge to `main`; that job does not exist yet, so prod has to remain reachable
 *   from a laptop — but never by typo or by an `APP_STAGE` left exported in a
 *   shell.
 *
 * Everything this does not consume is forwarded to `alchemy deploy`, so
 * `--dry-run`, `--force`, and the `--adopt` the first root-stack deploy needs
 * (ADR 0003 §Verification and adoption) all work through it.
 */

export const ProdConfirmationFlag = "--confirm-prod"

export interface DeployPlan {
  readonly stage: string
  /** The full argument list handed to `alchemy`, in order. */
  readonly args: ReadonlyArray<string>
}

/** ADR 0003: the stage is `--stage`, else `APP_STAGE`, else `dev_<user>`. */
export const resolveDeployStage = (
  args: ReadonlyArray<string>,
  env: { readonly APP_STAGE?: string | undefined; readonly USER?: string | undefined },
): string => {
  const flagIndex = args.indexOf("--stage")
  const explicit = flagIndex < 0 ? undefined : args[flagIndex + 1]
  if (flagIndex >= 0 && (explicit === undefined || explicit.startsWith("-"))) {
    throw new Error("expected --stage <name>")
  }
  const stage = explicit ?? (env.APP_STAGE === "" ? undefined : env.APP_STAGE) ?? `dev_${env.USER}`
  if (env.APP_STAGE === undefined && (env.USER === undefined || env.USER === "")) {
    throw new Error("cannot resolve stage: pass --stage <name>, or set APP_STAGE or USER")
  }
  if (!/^(?:dev_[a-z0-9_-]+|prod)$/.test(stage)) {
    throw new Error(`refusing to deploy to "${stage}": expected dev_<name> or prod (ADR 0003)`)
  }
  return stage
}

export const planDeploy = (
  args: ReadonlyArray<string>,
  env: { readonly APP_STAGE?: string | undefined; readonly USER?: string | undefined },
): DeployPlan => {
  const stage = resolveDeployStage(args, env)
  const confirmed = args.includes(ProdConfirmationFlag)
  if (stage === "prod" && !confirmed) {
    throw new Error(
      `refusing to deploy prod without ${ProdConfirmationFlag}. One merge to main is a full ` +
        `prod release (ADR 0003) — Workers, routes, DNS, gateway, and database migrations. ` +
        `Pass ${ProdConfirmationFlag} if that is genuinely what you mean.`,
    )
  }
  // Drop what we consumed, keep the rest for the CLI: `--dry-run`, `--force`,
  // `--adopt`, `--log-level` and friends all belong to it, not here.
  const forwarded: Array<string> = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--stage") {
      index += 1
      continue
    }
    if (arg === ProdConfirmationFlag) continue
    if (arg !== undefined) forwarded.push(arg)
  }
  return { stage, args: ["alchemy", "deploy", "--stage", stage, "--yes", ...forwarded] }
}

const main = async (): Promise<void> => {
  const plan = planDeploy(process.argv.slice(2), {
    APP_STAGE: process.env.APP_STAGE,
    USER: process.env.USER,
  })
  console.log(`deploy — stage ${plan.stage}: bunx ${plan.args.join(" ")}`)
  const code = await new Promise<number>((resolvePromise, reject) => {
    const child = spawn("bunx", plan.args, {
      stdio: "inherit",
      env: { ...process.env, CI: "1" },
    })
    child.on("error", reject)
    child.on("close", (status) => resolvePromise(status ?? 1))
  })
  if (code !== 0) throw new Error(`alchemy deploy exited with ${code}`)
  console.log(`deploy — done (stage ${plan.stage})`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
