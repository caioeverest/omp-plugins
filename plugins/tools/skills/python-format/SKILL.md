---
name: python-format
description: Set up or repair Python formatting with ruff format (or black), import order, and line length. Use for formatter setup, format-check failures, import-order drift, or line-length decisions. Not for general lint rules.
---

# Python formatting

## Standard

- **One formatter:** `ruff format` (black-compatible) — or `black` already in the repo, never both.
- **Import order:** ruff's `I` rules cover isort semantics; no separate `isort`/`reorder-python-imports` run.
- **Line length:** one value for the repo, set in `pyproject.toml`; 100 is the default here. Never mix widths per directory.

## `pyproject.toml`

```toml
[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I"]

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
skip-magic-trailing-comma = false
line-ending = "auto"
docstring-code-format = false
```

`docstring-code-format = true` only when every Python snippet inside docstrings is already valid; otherwise the formatter rewrites examples.

## Working method

1. Run the repo's format wrapper — `uv run ruff format .` when it uses uv.
2. CI gates drift with `ruff format --check .`; `--diff` alone is a report and lets drift merge.
3. Check imports with `ruff check --select I .` (or the same `ruff check` under the repo's selected rules).
4. Keep formatting commits separate from behaviour changes.

## Avoid

- Running `black` after `ruff format`: each reformats the other's decisions.
- A pre-commit hook that reformats unrelated files; commit the format run with the code.
- Per-directory line lengths, or an 88/120 split left unannounced.
- `docstring-code-format = true` while docstrings hold non-Python examples.
