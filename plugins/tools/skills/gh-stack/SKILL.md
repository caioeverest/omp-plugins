---
name: gh-stack
description: Creates, maintains, reviews, and prepares GitHub stacked pull requests with the `gh stack` CLI. Use when user asks for stacked PRs, PR stacks, layered pull requests, `gh stack`, splitting a large change into reviewable PRs, synchronizing stacked branches, or landing a reviewed stack together.
---

# GitHub Stacks

Use `gh stack` for ordered, focused pull requests: each layer targets layer below it. Keep every layer independently understandable, testable, and reviewable.

## Safety rules

- Never run `gh stack merge`, `gh pr merge`, merge-queue actions, or `git push --force` directly. Human owns landing.
- Never use `gh stack merge --yes`.
- Before state-changing stack command, state command/effect; get explicit confirmation.
- Prefer `gh stack` over manual rebases, retargeting, or force pushes.
- Stop on conflict, divergence, failed checks, unexpected PR state, or dirty tree. Explain recovery; do not guess.

## Preflight

From repository root, run:

```bash
bash {baseDir}/scripts/preflight.sh
```

Fix failures before changing stack. Script is read-only. It checks repository, clean tree, `gh` authentication, `gh stack`, `origin`, default branch, and active stack.

## Design stack

1. Read task, repository instructions, affected code.
2. Propose bottom-to-top layers: one purpose, minimal diff, focused tests, no dependency on higher layer.
3. Foundations first: types/config/schema → implementation → integration → UI/docs/tests where needed.
4. Avoid drive-by refactors; fold inseparable edits into same layer.
5. Tell user layers, branch names, validation, landing plan. Get confirmation.

## Create stack

For fresh work, initialize first branch from trunk:

```bash
gh stack init <bottom-branch>
```

For non-default trunk:

```bash
gh stack init --base <trunk> <bottom-branch>
```

Implement, test, and commit each layer. Only while on current top layer, add next branch:

```bash
gh stack add <next-branch>
```

If adopting existing ordered branches:

```bash
gh stack init <bottom> <middle> <top>
```

Confirm structure anytime:

```bash
gh stack view
```

## Submit and review

After all local checks pass, confirm before `gh stack submit`. Use interactive submit. Write distinct title/body: what, why, validation, dependency context. Mark incomplete/noisy layers draft. Do not use `--auto` unless user accepts generated metadata.

Review bottom-up. Address feedback in owning layer, rerun relevant tests. Use `gh stack view` to verify ordering/base branches.

## Keep stack current

Before significant edits or after remote/trunk changes, preflight then confirm before `gh stack sync`.

`sync` fetches, rebases, pushes, and syncs PR state. On conflict: resolve, stage, ask before `gh stack rebase --continue`; use `--abort` only after user approves rollback. On true divergence, stop; consider unstack + re-init only with approval.

Use `gh stack modify` for reorder/insert/fold/rename; require clean tree + confirmation. Run `gh stack submit` after restructuring remote stack.

## Landing handoff

Only after every intended PR is open, non-draft, approved, green, and stack view is correct:

1. Tell user exact stack/PRs ready, unresolved risks, and merge-queue behavior if present.
2. Tell user to run `gh stack merge` interactively, or use GitHub stack UI, to choose target layer and confirm.
3. Do not execute landing command. After human lands it, run preflight/sync if user asks cleanup.

## Reference

Feature public preview; behavior can change. Verify uncertain flags with `gh stack <command> --help`.

- GitHub docs: https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands
- Announcement: https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/
