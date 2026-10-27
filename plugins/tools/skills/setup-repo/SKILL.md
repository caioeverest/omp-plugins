---
name: setup-repo
description: Configure this repo for the engineering skills — initialize beads (bd) as the task manager and lay out domain docs. Run once before first use of the other engineering skills.
disable-model-invocation: true
---

# Setup Repo Skills

Scaffold the per-repo configuration that the engineering skills assume. Straightforward by design: beads is the task manager, the state vocabulary is fixed, and domain docs default to single-context. Explore, confirm the issue prefix, write.

## Process

### 1. Explore

- `bd --version` — beads CLI installed?
- `.beads/` at the repo root — already initialized? Note the prefix (`.beads/metadata.json` → `dolt_database`).
- `AGENTS.md` and `CLAUDE.md` at the repo root — which exists? Is there already an `## Agent skills` section?
- `CONTEXT.md` at the repo root, `docs/adr/`, `docs/agents/` — prior output already there?
- Monorepo signals — `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, populated `packages/*`. Absence means single-context (almost every repo).

### 2. Set up beads

1. **CLI missing** → `brew install beads`.
2. **Not initialized** → derive the issue prefix from the repo directory name (short, lowercase, alphanumeric — `omp-marketplace` → `om`), confirm it with the user in one line ("Prefix `om` → issue ids `om-42` — ok?"), then run `bd init --prefix <prefix>`. Already initialized with a different prefix → offer `bd rename-prefix` instead. Same prefix → nothing to do.
3. Write `docs/agents/issue-tracker.md` from [issue-tracker-beads.md](./issue-tracker-beads.md). It fixes the whole convention — bd commands, dependency edges, and the state vocabulary below — so every consumer skill reads the same rules.

**State vocabulary (fixed, no choices):**

| State | beads representation |
|-------|---------------------|
| `needs-triage` | open issue with no triage label |
| `needs-info` | status `deferred` (hidden from `bd ready` until the reporter replies) |
| `ready-for-agent` | label `ready-for-agent` — agents grab these: `bd ready -l ready-for-agent` |
| `ready-for-human` | label `ready-for-human` — HITL, waiting on a person |
| `wontfix` | closed with a `wontfix` reason |

This is the only requirement the skills have: **agent-tackleable vs human-waiting is two labels on bd issues**, everything else is native bd status.

### 3. Domain docs

Default to **single-context** — one `CONTEXT.md` + `docs/adr/` at the repo root; write `docs/agents/domain.md` from [domain.md](./domain.md) without asking. Only when exploration found monorepo signals, offer multi-context (root `CONTEXT-MAP.md` → per-context `CONTEXT.md`) and confirm the layout.

### 4. Agent docs block

Edit whichever of `CLAUDE.md` / `AGENTS.md` exists (if neither, ask which to create — don't pick). Update an existing `## Agent skills` block in-place; never duplicate it, never overwrite surrounding user edits:

```markdown
## Agent skills

### Task manager

All task tracking goes through beads (`bd`); issue ids are `<prefix>-<n>`. See `docs/agents/issue-tracker.md` and the `beads` skill.

### Domain docs

[one-line summary — "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

### 5. Done

Report what was set up and which skills now read these files. `docs/agents/*.md` can be edited directly later; re-running this skill is only needed to start over.
