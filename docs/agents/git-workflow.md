# Git workflow: branches, CI, and PRs

`main` is always green. **Code** happens on branches and lands via a squash-merged PR with green CI. **Planning artifacts** (ADRs, specs, wayfinder maps and tickets, agent docs) may land on `main` directly — there is no CI to gate prose, and the wayfinder map is edited by many short sessions.

The `pre-push` hook enforces the split: a push to `main` is allowed only when every changed file matches `docs/**`, `*.md`, `AGENTS.md`, or `CONTEXT.md`; touching anything else is blocked and must go through a PR. Enable per clone with `git config core.hooksPath .githooks`. Changing the hook itself is deliberately gated too. The server-side gate is branch protection; `--no-verify` is the escape hatch.

## Branches

- Issue implementation branch: `issue-{number}-{slug}`, `{slug}` = issue title in kebab-case.
  Example: `issue-186-managed-clientbot-provisioning`.

## Commits

- Conventional Commits: `type(scope): subject` (`feat`/`fix`/`docs`/`chore`/`refactor`/`test`/…), imperative English subject.
  Example: `feat(db): add managed bot installations`.

## Pull requests

- PR title repeats the issue title and number: `{issue title} (#{number})`.
- Merge by **squash** (GitHub appends the PR number): the commit lands as `{issue title} (#{issue}) (#{pr})`.
  Example: `M3: provision and recover managed ClientBot (#186) (#201)`.
- Delete the branch after merge: `--delete-branch`.

## Worktrees

- If an issue was implemented in a worktree, after merge run `git worktree remove <path>` and `--delete-branch`.
- Merging from a worktree does **not** auto-delete the remote branch — remove it manually: `git push origin --delete <branch>`.
