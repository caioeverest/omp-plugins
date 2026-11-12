---
name: wizard
description: Generate an interactive bash wizard that walks a human through steps only they can perform — provisioning, credentials, CI secrets, a third-party dashboard, or a one-off migration. Not for steps the agent can run itself.
---

# Wizard

A wizard is a bash script that walks a human step by step through a manual procedure that is tedious to repeat and tedious to re-explain to an AI. It opens each URL, states exactly what to click and copy, captures the values, writes them where they belong, confirms before irreversible actions, and shows progress.

[template.sh](template.sh) already solves the UX: stage progress, confirmation gates, cross-platform URL opening (including WSL), hidden secret entry, idempotent `.env` upserts, `gh secret`/`gh variable` writes, and a closing summary. Scope the procedure and author its stages; the library above the `STAGES` marker is identical in every wizard — never hand-edit it.

A wizard is ephemeral by default: built for one run, saved to a scratch or `scripts/` path, deleted when the job is done. Commit it only when the user wants a repeatable setup path that lives in the repo.

## 1. Scope the procedure

Read the repo first; don't ask cold.

- Setup: `.env`, `.env.example`, `.env.*`, `README`, `docker-compose*`, framework config, and `.github/workflows/*` — every `secrets.*` / `vars.*` reference is a value the wizard must produce.
- Migration or transition: current state, target state, and the irreversible actions between them.

Show the user the ordered stages and the values each produces, then confirm; they may add, drop, or reorder.

**Done when** every stage is named in order, and for each captured value you know (a) where the human gets it, (b) where it is written (`.env`, GitHub secret, both, or nowhere for pure actions), and (c) whether it is secret.

## 2. Map each stage's journey

Write the precise path a human follows: URL to open, what to do, where the value appears, which variable it fills — e.g. "Dashboard → Developers → API keys → Reveal test key → copy". Where the current UI or exact command is unknown, say so and ask the user or check the docs; never invent steps.

**Done when** every stage traces to concrete instructions a stranger could follow.

## 3. Author the wizard

Copy `template.sh` to the target path. Replace the example stage with one `stage` per step in dependency order, using the library helpers — `stage`, `say`/`step`, `open_url`, `ask`/`ask_secret`, `write_env`, `set_secret`/`set_var`, `pause`/`confirm` — and set `TOTAL_STAGES` to the number of stages written.

Hold the template's bar: open the URL before asking for its value; `ask_secret` for anything secret; `write_env` every persisted value; `set_secret` only values CI actually reads; `confirm` before any irreversible action. Keep a stage to one focused task so nothing needed scrolls away.

## 4. Verify and hand off

- `bash -n <script>`; run `shellcheck` when available; `chmod +x <script>`.
- Do not run it end to end — it opens browsers and blocks on human input. Trace it statically: every value from step 1 is captured and lands where step 1 said, and every `set_secret` name exactly matches a `secrets.*` reference in CI.
- Tell the user how to run it. For a repeatable setup path, commit it and link it from the README so the next person runs the script instead of asking an AI.
