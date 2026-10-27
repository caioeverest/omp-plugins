---
name: persona-switcher
description: >
  Create, switch, inspect, and remove fictional or archetypal personas that
  change only the OMP agent's expression: tone, voice, and character. Use when
  the user asks to adopt or create a persona, switch personality, list saved
  personas, return to the default voice, or remove a saved persona.
---

# Persona Switcher

Personas change **how the agent communicates**, never its reasoning, safety rules, tool use, or technical correctness. OMP loads the active persona from the user-level `PERSONALITY.md` file; it takes effect in a new OMP session.

## Storage and activation

- **Library:** `~/.omp/agent/personas/<slug>.md`
- **Active slot:** `~/.omp/agent/PERSONALITY.md`
- **Backup:** `~/.omp/agent/PERSONALITY.md.persona-switcher-backup` when switching would replace an unmanaged personality file.

The `/persona` command (same subcommands: `list`, `current`, `use <slug>`, `off`, `show <slug>`, `remove <slug> --confirm`; `/persona generate <brief>` is for the user only — it queues a prompt for this agent) is a user-facing TUI command. When you as the agent perform the file operations, use `scripts/persona.sh` instead — you cannot execute slash commands:

```sh
scripts/persona.sh list
scripts/persona.sh current
scripts/persona.sh use <slug>
scripts/persona.sh off
scripts/persona.sh show <slug>
scripts/persona.sh remove <slug> --confirm
```

For a non-default OMP profile, set `OMP_PERSONA_AGENT_DIR` to that profile's agent directory before running the script.

## Create a persona

Creation is owned by the `persona-generator` skill: load `skill://persona-generator` and follow its workflow. It scopes the brief, derives the slug, reads this skill's `skill://persona-switcher/references/PERSONA_MATRIX_TEMPLATE.md`, and saves through the `persona_create` tool. Do not write `~/.omp/agent/personas/<slug>.md` with other tools, and do not invent a competing save path here.

## Prompt discipline

The active file appears in every session's system prompt. Keep it short and behaviorally useful:

- Matrix rows are fragments, not biography.
- Three concrete tone rules and two micro-examples are sufficient.
- Preserve the hard rules verbatim.
- Keep code blocks, paths, commands, diffs, and safety-critical explanations neutral and precise.

## Switch and remove

- “Switch to Nova” → `scripts/persona.sh use nova`.
- “What persona is active?” → `scripts/persona.sh current`.
- “Return to normal” → `scripts/persona.sh off`.
- “Delete Nova” → `scripts/persona.sh remove nova --confirm`.

`off` restores an unmanaged `PERSONALITY.md` that was backed up before activation. It does not alter OMP's `personality` setting; if that setting is `none`, OMP omits every personality file.
