---
name: worktree-parallel
description: Run parallel subagents safely by giving each an isolated git worktree, then merge their patches or commits back to the original branch. Use when dispatching multiple agents that edit the same repo, when parallel edits conflict, or when the user mentions worktrees, isolated agents, or parallel subagent changes.
---

# Parallel Subagents with Git Worktrees

Multiple subagents editing the same working tree conflict: overlapping file edits collide, and one agent's `git add -A` sweeps up another's changes. The fix: run each writer in its own git worktree (a separate checkout of the same repo), collect its changes, and merge them back to the original branch one at a time. Conflicts between agents are resolved sequentially by you, never inside a parallel agent.

## When to isolate

- **Isolate** when two or more agents will write/edit files in the same repo concurrently.
- **No isolation** for read-only agents (scout/research) or agents editing disjoint repos.
- When in doubt, isolate — the cost is one extra checkout per agent.

## Two ways to spawn an isolated agent

**1. `agent(..., { isolated: true })` — inline worktree.** The agent works in a fresh worktree off the current branch and you merge its result back yourself. The result names the worktree path; find the worktree branch with `git worktree list` (or `git -C <worktree-path> branch --show-current`). Requires isolation mode enabled (`task.isolation.mode` — if you get "isolated execution requires task.isolation.mode to be set", it isn't).

```js
const a = agent("Refactor auth per local://plan.md", { isolated: true, handle: true });
const b = agent("Add billing logs per local://plan.md", { isolated: true, handle: true });
```

**2. `task` batch — worktree per item.** A `tasks: [...]` batch runs each item in its own worktree automatically when the batch edits files. Same merge-back rules apply; each settled job names its worktree/branch.

Either way, a read-only scout can run un-isolated alongside the writers.

## Collect changes: patch or commit

An isolated agent may leave the worktree **dirty** (uncommitted edits) or **committed** (one or more commits on its worktree branch). Handle both.

### A. Dirty worktree → patch

```bash
git -C <worktree-path> diff HEAD > /tmp/agent.patch
git apply /tmp/agent.patch        # on the original branch
```

### B. Committed worktree → merge or cherry-pick

The agent committed to a worktree branch. Bring those commits onto the original branch:

```bash
WT=<worktree-path>
BR=$(git -C "$WT" branch --show-current)
# from the original branch, merge the worktree branch
git merge --no-ff "$BR"
# or replay just its commits:
git cherry-pick <oldest-sha>^..<newest-sha>
```

Prefer **merge** when the worktree branch should land as a unit (keeps history). Prefer **cherry-pick** when you only want some commits or a linear history.

### Apply one agent at a time

Apply/merge sequentially. If agent B's changes conflict with agent A's already-merged patch, resolve now — you hold both diffs locally. Then clean up:

```bash
git worktree remove <worktree-path> --force
git branch -D <worktree-branch>     # if a branch was created
```

Repeat per agent. Keep merge order explicit; never let two agents merge the original branch themselves.

## Rules

- **You own the original branch.** Subagents report patches or worktree commits; the orchestrator applies them. A subagent must never push, merge, or commit to the shared/original branch.
- **Isolate every writer.** Even two writers on disjoint file sets — index locks and shared-tree sweeps still collide.
- **Skim before applying.** A worktree edit can still be wrong; read the diff before `git apply` / `git merge`.
- **Remove worktrees when done.** Stale worktrees pin branches and leak disk. Audit with `git worktree list`.
- **Dependencies stay serial.** If agent B needs A's output, sequence them, or apply A's patch before spawning B.

## Fallback: agents already conflicted in the main tree

If un-isolated writers already collided, don't patch on top. Quarantine and re-run isolated:

```bash
git stash                  # quarantine the collision
git worktree list          # confirm no stray worktrees
# re-dispatch with isolated: true on disjoint slices
```
