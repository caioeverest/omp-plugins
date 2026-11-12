---
name: resolving-merge-conflicts
description: "Resolve an in-progress git merge or rebase conflict. Use when a merge/rebase has conflicts or conflict markers, or the merge needs finishing."
---

# Resolve Merge Conflicts

Work on the merge or rebase already in progress. Stay read-only until resolution: do not abort, reset, or start a different merge.

## 1. Read the state

```bash
git status
git log --merge --oneline
git diff --name-only --diff-filter=U
```

Identify merge vs rebase and every conflicted file. If no merge or rebase is in progress, stop and say so.

## 2. Find both primary sources

For each conflict, read the commits that produced each side (`git log --merge -p -- <file>`), the merge base, commit messages, and the linked PR or issue. State each side's intent before editing. Guessing at intent is how a merge silently drops work.

## 3. Resolve each hunk

Preserve both intents where they compose. Where they are incompatible, choose the side matching the merge's stated goal and record the trade-off in the merge commit. Do not invent behavior, add unrelated changes, or clean up surrounding code.

- Unambiguous intent → resolve.
- Ambiguous or genuinely incompatible intent → ask the user before choosing.
- Binary, generated, or lock files → regenerate with the repo's tool or take the correct side; never hand-merge them.

## 4. Verify

- No conflict markers remain: `git diff --check`, and search the resolved files for `^(<<<<<<<|=======|>>>>>>>)`.
- Run the project's checks in its documented order — typically typecheck, tests, then format. Fix breakage caused by the merge; report pre-existing failures instead of hiding them.
- Re-read each resolved region: no duplicated imports, lost hunks, or half-applied changes.

## 5. Finish

Stage the resolved files, then complete the operation:

```bash
git add <resolved-paths>
git commit                 # merge
git rebase --continue      # rebase; repeat for each remaining commit
```

Done when `git status` shows no merge or rebase in progress, every conflict is resolved, and the project's checks pass.

Abort only when the user asks or the merge was started in error; confirm first and explain what will be lost. Never force-push.