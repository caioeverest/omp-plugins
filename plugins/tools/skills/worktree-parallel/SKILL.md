---
name: worktree-parallel
description: Run multiple writing subagents safely by isolating each in its own checkout, then apply or merge their patches to the original branch. Use when dispatching parallel agents that edit the same repo or when parallel edits collide. Read-only agents need no isolation.
---

# Parallel subagents with isolated workspaces

Two writers in the same working tree collide: overlapping edits fight, and one agent's `git add -A` sweeps up another's changes. Run each writer in an isolated checkout, then bring its work back one agent at a time.

## Detect isolation first

Check before creating anything: when `GIT_DIR` differs from `git rev-parse --git-common-dir`, you are already inside a linked worktree — use it. A submodule (`git rev-parse --show-superproject-working-tree` returns a path) is treated as a normal repo.

Ask before creating a worktree in someone's repo. Then verify the directory is gitignored (`git check-ignore <dir>`) before the first `git worktree add` — an unignored project-local directory puts an entire second checkout into the next commit. Directory precedence: what the user named, then an existing `.worktrees/`, then `worktrees/`, then a fresh `.worktrees/`.

Run the tests once in the fresh checkout before handing it to a writer. A red baseline makes every later failure ambiguous, and saying so costs less than diagnosing it twice.

## When to isolate

- **Isolate** when two or more agents will write in the same repo concurrently, even on disjoint files — index locks and whole-tree commands still collide.
- **Skip** for read-only scouts or agents editing separate repos.
- Dependencies stay serial: if B needs A's output, apply A before spawning B.

## Dispatch an isolated writer

The documented route is the eval `agent()` helper with `isolated: true`. It requires isolation enabled in settings — `task.isolation.enabled: true` (the legacy `task.isolation.mode` setting migrates to that plus `isolation.backend`) — and is unavailable in plan mode. `isolation.backend` picks the mechanism: a git worktree, an overlay, or another copy-on-write checkout.

```js
const a = await agent("Refactor auth per local://plan.md", { isolated: true, label: "AuthRefactor" });
const b = await agent("Add billing logs per local://plan.md", { isolated: true, label: "BillingLogs" });
```

Python uses keyword arguments (`agent(prompt, isolated=True, label="AuthRefactor")`); without `await`, the call returns the handle. `apply: false` keeps changes as artifacts instead of applying them; `merge: false` forces patch mode; otherwise `task.isolation.merge` decides.

**`task` batches do not isolate.** The batch schema exposed in a session may omit isolation entirely, so don't assume a per-item flag. Dispatch writers through `agent(..., { isolated: true })`; a read-only `scout` can run alongside in a normal task batch.

**Fallback when eval isolation is unavailable.** Prefer sequential dispatch: run writers one after another in the main checkout, settling each before starting the next. If writers must run concurrently, create one checkout per writer and require every child to use absolute paths inside its assigned checkout:

```bash
git worktree add ../repo-agent-a -b agent/a
git worktree add ../repo-agent-b -b agent/b
```

A task child keeps the session's cwd, so relative paths and `git` commands land in the original checkout. Give each writer its absolute checkout path, keep git operations with the orchestrator, and apply the collection and cleanup rules below.

## What comes back

Each settled isolated result reports its workspace and changes: branch, base SHA, patch paths, and any nested patches. The workspace path is discoverable with `git worktree list` (worktree backend) or from the result. The child does not inherit the conversation, so its task must be complete and self-contained.

## Bring the work back

With `apply: false`, an isolated agent leaves its work as artifacts — the checkout dirty or committed on its branch.

**Applied automatically (merge mode)** — review the result, then verify the merge actually landed before starting the next agent.

**Patch mode** — apply the captured patch from the original branch:

```bash
git apply "<patch-path>"
```

**Committed worktree** — merge the task branch as a unit, or replay selected commits:

```bash
BR=$(git -C "<worktree-path>" branch --show-current)
git merge --no-ff "$BR"
git cherry-pick <oldest-sha>^..<newest-sha>   # selected commits only
```

Apply one agent at a time. If B conflicts with A's already-applied work, resolve it now — you hold both diffs locally.

Clean up after each agent — remove from outside the worktree, then delete the branch:

```bash
git worktree remove "<worktree-path>"
git branch -D "$BR"          # when a branch was created
git worktree prune
```

Remove only checkouts this work created, and never `--force`: when removal is refused because untracked files are present, show them and ask. `--force` is how someone else's uncommitted work disappears.

## Rules

- **You own the original branch.** Subagents report patches or task branches; the orchestrator applies or merges them. A subagent never pushes or commits to the shared branch.
- **Skim before applying.** Read the patch or diff; a clean apply is not a correct change.
- **Do not let two agents merge.** Serial application keeps conflicts resolvable.
- **Remove checkouts when done.** Stale worktrees pin branches and leak disk; audit with `git worktree list`.

## Recovery: writers already collided

Do not patch on top. Quarantine, then re-dispatch isolated:

```bash
git stash
git worktree list
```
