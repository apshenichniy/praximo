/**
 * The one way a script reads a variable it cannot run without (#139).
 *
 * Six scripts each carried their own copy of this, under two names and with
 * three different messages — including two that told an operator a variable was
 * missing without saying where to set it, which is the only actionable half of
 * the sentence.
 *
 * Almost every value here comes from the gitignored root `.env` (ADR 0003 — the
 * agent does all devops; the human only supplies that file), so that is the
 * default hint. `hint` is for the exceptions: `ci-neon-branch.ts` runs in GitHub
 * Actions, where the fix is a repository secret rather than a local file.
 */

const DOT_ENV_HINT = "set it in the root .env (see .env.example)"

export const requireEnv = (name: string, hint: string = DOT_ENV_HINT): string => {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`missing ${name} — ${hint}`)
  }
  return value
}
