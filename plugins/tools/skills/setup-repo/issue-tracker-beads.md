# Task manager: beads (bd)

Issues, tickets, and specs for this repo live in **beads** — the `bd` CLI's persistent, Dolt-backed issue tracker initialized in this repo (`.beads/`). Use `bd` for all task tracking; never use GitHub/GitLab issues or ad-hoc markdown files for it.

**Always defer to the `beads` skill** for the full workflow (session protocol, dependencies, compaction recovery). Run `bd prime` for live CLI context and `bd <command> --help` for exact flags — both auto-update with the installed bd.

## Conventions

- **Find work**: `bd ready --json` — unblocked, unclaimed work.
- **Read a ticket**: `bd show <id> --json` (`--long` for extended metadata).
- **Create**: `bd create "<title>" -t <bug|task|feature|epic> -p <0-4> --json`.
- **Claim**: `bd update <id> --claim --json` — a session's first write.
- **Note progress**: `bd update <id> --notes "..." --json` — critical for compaction survival.
- **Apply labels**: `bd label add <id> <label>`.
- **Close**: `bd close <id> --reason "..." --json`.
- **Sync**: `bd dolt push` (only if a Dolt remote is configured).

## State vocabulary

Agent-tackleable vs human-waiting is two labels on bd issues; everything else is native bd status:

| State | beads representation |
|-------|---------------------|
| `needs-triage` | open issue with no triage label |
| `needs-info` | status `deferred` — hidden from `bd ready` until the reporter replies, then back to `open` |
| `ready-for-agent` | label `ready-for-agent` — agents grab these: `bd ready -l ready-for-agent` |
| `ready-for-human` | label `ready-for-human` — HITL, waiting on a person |
| `wontfix` | closed with a `wontfix` reason |

Transitions: `bd label add <id> ready-for-agent`, `bd update <id> -s deferred`, `bd update <id> -s open`, `bd close <id> --reason "wontfix: ..."`.

## When a skill says "publish to the issue tracker"

Run `bd create ...` and report the new issue id.

## When a skill says "fetch the relevant ticket"

Run `bd show <id> --long --json`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single epic; **child** issues hang off it via dependencies.

- **Map**: one epic — `bd create "<goal>" -t epic --json`.
- **Child ticket**: `bd create "<title>" -t task --deps 'parent-child:<epic-id>' --json`.
- **Blocking**: `bd dep add <blocked-id> <blocker-id> --type blocks` — the live gate for readiness.
- **Frontier query**: `bd ready --json` — dependency-aware by construction; first ready item wins.
- **Claim**: `bd update <id> --claim --json` — the session's first write.
- **Resolve**: `bd close <id> --reason "<answer>" --json`, then append the outcome to the map: `bd update <map-id> --append-notes "..."` (see `bd update --help`).
