---
name: python-format
description: Configure Python formatting with ruff format (or black), enforce import order, line length, and drift-free style. Use when setting up formatting, fixing format check failures, or reviewing formatter drift.
---

# Python Formatting

Standard for Python formatting. Loads when: setting up/drift check of formatter, import ordering, line-length decisions, fixing format failures.

## Formatter

- **Primary:** `ruff format` — drop-in replacing `black`. One formatter per repo, never two.
- **Import order:** `ruff` (`I` rule) handles isort semantics; no separate `isort`/`reorder-python-imports` run.
- **Line length:** standard 100; match `pyproject.toml` `[tool.ruff]` only. Never leave 88/120 mismatched across repo files without a PR-wide announcement.

## Standard config

In `pyproject.toml`:

```toml
[tool.ruff.format]
quote-style = "double"
indent-style = "space"
skip-magic-trailing-comma = false
line-ending = "auto"
docstring-code-format = false

[tool.ruff]
line-length = 100
```

## Working method

1. Run `uv run ruff format .` (or repo's format wrapper). CI must check format before merge.
2. `--check` in CI to fail drift, never `--diff` only — drift that CI tolerates becomes the new style.
3. Never bundle formatter updates with behavior changes — separate commit/PR stylistically.
4. Import order follows `ruff` (`isort`) semantics: stdlib → third-party → first-party. Case-sensitive ordering is default.

## Anti-patterns

- ❌ running `black` after `ruff format` — the two formats end up chasing each other's decisions.
- ❌ formatter in a pre-commit that applies non-deterministic changes — commit the format run alongside code, don't run it unstaged.
- ❌ changing line length per directory — one line length per repo.
- ❌ docstring code-format enabled while docstrings contain non-Python snippets — keep `docstring-code-format = false` unless repo curates it.
