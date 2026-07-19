# Git workflow: branches, CI, and PRs

`main` is always green. All work happens on branches and lands via a squash-merged PR with green CI. Direct pushes to `main` are blocked locally by the `pre-push` hook (`git config core.hooksPath .githooks`); the server-side gate is branch protection.

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
