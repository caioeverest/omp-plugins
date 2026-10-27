# Persona Switcher

Provides the `/persona` command and the `persona_create` model tool for the OMP user-level personality slot.

```text
/persona
/persona list
/persona current
/persona use <slug>
/persona generate <brief>
/persona off
/persona show <slug>
/persona remove <slug> --confirm
```

`/persona generate <brief>` hands the brief to the running agent as a prompt; the agent loads the `persona-generator` skill, authors the matrix, and saves it through `persona_create`. The tool is how the agent saves a generated persona: it takes a `slug` and raw persona Markdown, validates the slug, refuses to overwrite an existing persona, and writes `<agent-dir>/personas/<slug>.md`. Authoring guidance (research, matrix format, length) lives in the bundled `persona-generator` skill; the tool itself does no generation.

Bare `/persona` opens interactive picker in TUI; choose persona to activate or `off` to restore default personality. `list` and `show` open Esc-to-close overlays. `current`, successful changes, and errors use notifications.

Personas live in `<agent-dir>/personas/<slug>.md`; the active persona is written to `<agent-dir>/PERSONALITY.md`. The agent directory is profile-aware because the plugin gets it from OMP settings. A non-managed `PERSONALITY.md` is backed up once before activation and restored by `/persona off`.

The command changes files for future sessions only. Start a new OMP session after switching. The OMP `personality` setting must not be `none`, or OMP will omit `PERSONALITY.md`.

Use the bundled `persona-generator` skill to research and author persona matrices, then save them through `persona_create`. The extension does not create personas from a name alone.
