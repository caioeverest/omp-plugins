---
name: beads
description: Persistent Dolt-backed issue tracker for work that outlives one session, has blockers, or must survive compaction. Use for multi-session tasks, dependency graphs, "what's ready", and resuming after context loss. Single-session checklists belong in TodoWrite instead.
---

# Beads — persistent task memory

Graph-based issue tracker that survives conversation compaction and keeps multi-session work, dependencies, and context recoverable across sessions.

## bd vs TodoWrite

**Decision test:** will this context still matter in two weeks? Yes → `bd`; no → TodoWrite.

| bd (persistent) | TodoWrite (ephemeral) |
| --- | --- |
| Multi-session work, dependencies, compaction survival | Single-session linear tasks |
| Dolt-backed team sync | Conversation-scoped |

See [BOUNDARIES.md](resources/BOUNDARIES.md) for the full comparison.

## Prerequisites

```bash
bd --version  # tested with v0.60.0+
```

`bd` must be provisioned through the repo's mise configuration (`mise install`). When `bd --version` fails, stop and tell the user the prerequisite is missing; don't install it with an ad-hoc package manager.

- Initialization is a one-time, human-confirmed setup step: `bd init --prefix <prefix>`. The `setup-repo` skill owns it. Ask for that path instead of initializing implicitly.
- A git repository is optional; `BEADS_DIR` plus `--stealth` supports git-free use.

## Session protocol

1. `bd ready` — find unblocked work.
2. `bd show <id>` — read full context.
3. `bd update <id> --claim` — claim and start atomically.
4. Add notes as you work; notes are what survives compaction (`bd update <id> --notes "..."`).
5. `bd close <id> --reason "..."` — complete the task.
6. `bd dolt push` — sync, only when a Dolt remote is configured.

Run `bd prime` for live AI-oriented workflow context (hooks auto-load it), and `bd <command> --help` for exact flags. Both track the installed version and are canonical.

When the `close_todo_chain(id)` tool is available it is the required close path for a chain: pass the root issue id only; the tool discovers every transitive `blocks` dependent, batches the closes, and returns JSON. Do not close chain members with repeated manual commands.

## Dependencies

Dependency edges are the durable part of the tracker: `blocks`, `parent-child`, `related`, `discovered-from`. `bd ready` is dependency-aware, so model real blockers as `blocks` instead of prose. Full semantics and edge-selection guidance: [DEPENDENCIES.md](resources/DEPENDENCIES.md).

## Output and errors

Append `--json` for structured output; `bd show <id> --long` adds metadata. Status icons: `○` open, `◐` in progress, `●` blocked, `✓` closed, `❄` deferred.

| Error | Fix |
| --- | --- |
| `database not found` | Run `/setup-repo`, or ask the user to `bd init <prefix>` in the project root. |
| `not in a git repository` | `git init`, or use `BEADS_DIR` + `--stealth`. |
| `disk I/O error (522)` | Move `.beads/` off a cloud-synced filesystem. |
| Status updates lag | Start server mode: `bd dolt start`. |

Full details: [TROUBLESHOOTING.md](resources/TROUBLESHOOTING.md).

## Examples

Track a multi-session feature:

```bash
bd create "OAuth integration" -t epic -p 1 --json
bd create "Token storage" -t task --deps blocks:oauth-id --json
bd ready --json
bd update <id> --claim --json
bd close <id> --reason "Implemented with refresh tokens" --json
```

Recover after compaction: `bd list --status in_progress --json`, then `bd show <id> --long`.

Capture discovered work: `bd create "Found bug" -t bug -p 1 --deps discovered-from:<current-id> --json`.

## Advanced features

| Feature | CLI | Resource |
| --- | --- | --- |
| Molecules (templates) | `bd mol --help` | [MOLECULES.md](resources/MOLECULES.md) |
| Chemistry (pour/wisp) | `bd pour`, `bd wisp` | [CHEMISTRY_PATTERNS.md](resources/CHEMISTRY_PATTERNS.md) |
| Agent beads | `bd agent --help` | [AGENTS.md](resources/AGENTS.md) |
| Async gates | `bd gate --help` | [ASYNC_GATES.md](resources/ASYNC_GATES.md) |
| Worktrees | `bd worktree --help` | [WORKTREES.md](resources/WORKTREES.md) |

## Resources

| Category | Files |
| --- | --- |
| Getting started | [BOUNDARIES.md](resources/BOUNDARIES.md), [CLI_REFERENCE.md](resources/CLI_REFERENCE.md), [WORKFLOWS.md](resources/WORKFLOWS.md) |
| Core concepts | [DEPENDENCIES.md](resources/DEPENDENCIES.md), [ISSUE_CREATION.md](resources/ISSUE_CREATION.md), [PATTERNS.md](resources/PATTERNS.md) |
| Resilience | [RESUMABILITY.md](resources/RESUMABILITY.md), [TROUBLESHOOTING.md](resources/TROUBLESHOOTING.md) |
| Advanced | [MOLECULES.md](resources/MOLECULES.md), [CHEMISTRY_PATTERNS.md](resources/CHEMISTRY_PATTERNS.md), [AGENTS.md](resources/AGENTS.md), [ASYNC_GATES.md](resources/ASYNC_GATES.md), [WORKTREES.md](resources/WORKTREES.md) |
| Reference | [STATIC_DATA.md](resources/STATIC_DATA.md), [INTEGRATION_PATTERNS.md](resources/INTEGRATION_PATTERNS.md) |

## Validation

`bd prime` is the canonical CLI source of truth and changes with each release ([ADR-0001](adr/0001-bd-prime-as-source-of-truth.md)). If `bd --version` is newer than the floor above, prefer `bd prime` and `--help` over any detail copied here.
