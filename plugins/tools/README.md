# OMP tools
General-purpose OMP extension for Beads, GitHub, PostgreSQL, and model-aware usage reporting.

## Tools

- Usage: `codex_usage` is model-aware. When the session model routes through OpenRouter, it reports OpenRouter key spend (`GET /api/v1/key` via `OPENROUTER_API_KEY`, all-time spend and optional credit limit) plus per-model token buckets from local OMP session files (today, last 7 days, this month). Otherwise (native OpenAI/Codex), it reports local token activity and the latest recorded five-hour/weekly account-limit snapshot.
- Beads: `add_todo`, `list_todos`, `read_todo`, `edit_todo`, `close_todo_chain`, `bd_init`, `todo_reset`, `del_todo`.
- GitHub: `look_for_prs`, `get_pr_details`.
- Marketplace: `update_marketplace` refreshes one marketplace's catalog (`omp plugin marketplace update`) and upgrades every plugin installed from it (`omp plugin upgrade <plugin>@<marketplace>` per plugin), reporting per-plugin results.
- PostgreSQL: `pg_query`, `pg_exec`, `pg_explain`, `pg_table_info`, `pg_locks`, `pg_stats`.

Write tools request OMP write approval. Destructive Beads operations require an explicit `confirm: true` argument.

## Team extensions

On session start the plugin offers to install shared extension packages via `omp install` (`@hypabolic/pi-hypa@1.2.0`, `npm:pi-rtk-optimizer@0.9.0`, `git:github.com/jonjonrankin/pi-caveman@bd0cc77fa74379de1c287e6dc0033d9b16a3a4dc`, `npm:@dietrichgebert/ponytail@5.3.2`). Already-installed packages are detected from the plugins registry and skipped; answering (either way) is recorded per plugin version in `<agent-dir>/omp-tools.json`, and a newer plugin version re-asks while anything is still missing. Extensions load at process start only, so a restart is needed after installing.

## Status line

The extension also renders a model-aware usage summary in the footer's extension status line. The branch follows the session model: OpenRouter-routed models show key spend with optional limit plus today's token bucket for the active model (`OpenRouter $3.42/$50 · 12.4k tok today`); native OpenAI/Codex models show plan type with five-hour/weekly window percentages, falling back to today's local token total when no limit snapshot is recorded (`Codex pro · 5h 42% · wk 12%`). Content refreshes on session start, before each agent turn, at turn end, and on a 60-second managed timer; the OpenRouter key fetch and the Codex session scan are cached for that interval. A missing `OPENROUTER_API_KEY` or an unreachable endpoint degrades to `n/a` spend with local tokens.

## Prerequisites

Install the command-line tools used by the capability you invoke: `bd`, `gh`, or `psql`.

Codex usage reads local session records from `$CODEX_HOME/sessions` or `~/.codex/sessions` and makes no network requests. The usage dashboard and an active Codex `/status` command are authoritative for current account limits. The OpenRouter branch makes one authenticated request to `openrouter.ai` when the session model routes through OpenRouter.

OpenRouter sections degrade gracefully: a missing `OPENROUTER_API_KEY` or an unreachable endpoint renders the key section as unavailable, and local bucket aggregation always runs from `<agent-dir>/sessions`.

## Codex limits

The helper mirrors the documented Codex surfaces: a primary five-hour window, a secondary weekly window, plan type, credits, and reset timestamps when those fields appear in local Codex session records. Codex, ChatGPT Work, and Workspace Agents can share an allowance and credit pool; usage varies by model, task complexity, context, reasoning, speed, and tools. Limits vary by plan and are not inferred from token counts.

For the authoritative current values, use [OpenAI's Codex usage documentation](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan), [Settings → Usage](https://chatgpt.com/codex/settings/usage), or `/status` in an active Codex CLI session.
