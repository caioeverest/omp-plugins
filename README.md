# OMP marketplace

`everest` is a local OMP marketplace containing first-party plugins together with bundled skills adapted from third-party projects — see [`ATTRIBUTION.md`](ATTRIBUTION.md). Its catalog contains the pinned Anthropic `frontend-design` plugin, the local `tools`, `persona-switcher`, and `telegram` extensions, and standalone skills maintained here.

## Prerequisites and setup

- OMP (`omp`) is on `PATH`.
- Python 3 is available for layout validation.
- macOS or Linux with Bash, Fish, or another shell that can execute the POSIX entrypoint.

From the repository root, run the executable entrypoint:

```sh
./bootstrap
```

The entrypoint invokes `scripts/bootstrap.sh` with its own interpreter, so it works when launched from Bash or Fish. Do not source it into the current shell.

Bootstrap validates the repository, registers the local `everest` catalog once (refreshing OMP's cached copy on later runs so catalog edits become installable), installs every catalog plugin for the current user, and prints marketplace and installed-plugin state. It uses your normal OMP configuration; to test bootstrap without touching personal state, run it inside an isolated profile: `OMP_PROFILE=bootstrap-test sh scripts/bootstrap.sh`.

Run `./bootstrap` whenever the catalog changes to ensure all declared plugins are installed.


## Layout

```text
.
├── .omp-plugin/
│   └── marketplace.json
├── plugins/
│   ├── .gitkeep
│   ├── tools/
│   ├── persona-switcher/
│   └── telegram/
├── scripts/
│   ├── bootstrap.sh
│   └── validate.py
└── skills/
    ├── .gitkeep
    └── <approved standalone skills>/
```

`skills-dev/`, if added later, is repository-maintenance material and is not shipped. Plugin-bundled skills belong inside their plugin.

## Included plugins

`frontend-design` is pinned to commit `ed404106fcd80ba98ecb7c851e531dcb626d13b7` of `anthropics/claude-plugins-official` through an OMP `git-subdir` source. It is available as `frontend-design@everest`.

Install one explicitly:

```sh
omp plugin install --scope project persona-switcher@everest
```

`tools@everest` provides Codex usage, Beads, GitHub pull-request, PostgreSQL, and marketplace-update tools, plus a model-aware usage summary in the footer status line. On session start it offers to install shared team extension packages via `omp install`. See [`plugins/tools/README.md`](plugins/tools/README.md) for its prerequisites and connection configuration.

`persona-switcher@everest` provides `/persona` for switching user-level OMP personality files from a saved library, plus the `persona_create` model tool and bundled `persona-generator` skill for generating new persona matrices. See [`plugins/persona-switcher/README.md`](plugins/persona-switcher/README.md) and its bundled `persona-switcher` skill.

`telegram@everest` provides `/telegram` and a single-owner Telegram bridge with focused chat tools. Bootstrap installs it, but a new OMP process plus an explicit `/telegram setup` or `/telegram connect` is required before any network polling or state mutation begins. See [`plugins/telegram/README.md`](plugins/telegram/README.md).

## Consumer commands

Register a local or remote catalog, inspect it, discover its plugins, and install a plugin for a project:

```sh
omp plugin marketplace add <path-or-source>
omp plugin marketplace list
omp plugin discover everest
omp plugin install --scope project <plugin>@everest
```

Update a registered marketplace and upgrade installed plugins when you explicitly choose to do so:

```sh
omp plugin marketplace update everest
omp plugin upgrade
```

Use `/reload-plugins` in an active session after plugin changes. Restart OMP completely for hooks, custom tools, extension modules, or other initialized runtime behavior.

## Add a first-party plugin

1. Create `plugins/<plugin-name>/`.
2. Add `plugins/<plugin-name>/package.json` with its lowercase marketplace-safe `name`, `version`, and `description`. Code extensions declare their documented entry points in `omp.extensions` (for example, `"omp": {"extensions": ["./src/index.ts"]}`).
3. Add `plugins/<plugin-name>/README.md` describing the plugin.
4. Add this catalog record to `.omp-plugin/marketplace.json`:

   ```json
   {
     "name": "<plugin-name>",
     "description": "<plugin description>",
     "version": "<plugin version>",
     "source": "./<plugin-name>"
   }
   ```

`metadata.pluginRoot` is `./plugins`, so `source: "./<plugin-name>"` resolves to `plugins/<plugin-name>/`. Names must be lowercase letters, digits, `-`, or `.`, start with a letter or digit, and be at most 64 characters.

## Add skills

A standalone skill is `skills/<skill-name>/SKILL.md`. A bundled skill is `plugins/<plugin-name>/skills/<skill-name>/SKILL.md`. Each `SKILL.md` needs YAML frontmatter delimited by `---` and a nonempty `description`; effective skill names must be unique across standalone and bundled skills.


## Validate changes

```sh
python3 scripts/validate.py
```

The validator uses only Python's standard library. It checks catalog identity, local source resolution, pinned `git-subdir` sources, and standalone/bundled skill frontmatter, placement, and duplicate names.

## Trust boundary

OMP plugins are unsandboxed code. Project scope limits plugin discovery; it is not an OS-permission or security boundary. Review plugin source and every catalog source before installing it.
