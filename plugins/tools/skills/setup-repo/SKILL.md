---
name: setup-repo
description: One-time repo setup for the engineering skills — initialize beads as the task manager and lay out domain docs. Run once per repo, before the workflow skills that expect docs/agents/.
disable-model-invocation: true
---

# Setup Repo Skills

Scaffold the per-repo configuration the engineering skills assume: beads is the task manager, the state vocabulary is fixed, and domain docs default to single-context. Explore, confirm the issue prefix, write.

## 1. Explore

- `bd --version` — CLI installed?
- `.beads/` — already initialized? Read the prefix from `.beads/metadata.json` → `dolt_database`.
- `AGENTS.md` / `CLAUDE.md` — which exists? Is there an `## Agent skills` section?
- `CONTEXT.md`, `docs/adr/`, `docs/agents/` — prior output?
- Monorepo signals — `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, populated `packages/*`. Absence means single-context.

## 2. Set up beads

1. CLI missing → stop and tell the user to provision `bd` through the repo's mise configuration (`mise install`); no ad-hoc package manager.
2. Not initialized → derive a short lowercase prefix from the repo directory (`omp-marketplace` → `om`), confirm it in one line ("Prefix `om` → issue ids `om-42` — ok?"), then run `bd init --prefix <prefix>`. Different existing prefix → offer `bd rename-prefix`. Same prefix → skip.
3. Write `docs/agents/issue-tracker.md` from [issue-tracker-beads.md](./issue-tracker-beads.md). That file is the single source for bd commands, dependency edges, state vocabulary, and transitions; other skills read it.

The one hard requirement: **agent-tackleable vs human-waiting is two labels on bd issues** — `ready-for-agent` / `ready-for-human`; everything else is native bd status.

## 3. Domain docs

Default to single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root, and write `docs/agents/domain.md` from [domain.md](./domain.md). Only when exploration found monorepo signals, offer multi-context (root `CONTEXT-MAP.md` → per-context `CONTEXT.md`) and confirm the layout.

## 4. Agent docs block

Edit whichever of `CLAUDE.md` / `AGENTS.md` exists; if neither, ask which to create. Update an existing `## Agent skills` block in place — never duplicate it, never overwrite surrounding user edits:

```markdown
## Agent skills

### Task manager

All task tracking goes through beads (`bd`); issue ids are `<prefix>-<n>`. See `docs/agents/issue-tracker.md` and the `beads` skill.

### Domain docs

[one-line summary — "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

## 5. Done

`bd init` succeeded (or the existing prefix was kept), `docs/agents/issue-tracker.md` and `docs/agents/domain.md` exist, and the agent docs block is present exactly once. Report what was created and which skills now read it. Re-running is only needed to start over; the written docs are edited directly afterward.
