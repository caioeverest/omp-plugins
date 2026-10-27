---
name: writing-agents
description: Reference for writing omp sub-agent definitions — the `name`/`description`/`systemPrompt` frontmatter contract, the description as a dispatch pointer, model and output-schema levers, and source precedence. Use when creating, editing, reviewing, or debugging an agent file in `.omp/agents/` or `~/.omp/agent/agents/`, or when a spawn fails to find an agent.
disable-model-invocation: true
---

# Writing Agents

An agent definition is a document an agent consumes; everything in `writing-for-agents` (context pointers, information hierarchy, leading words, pruning) applies in full. What changes here is the mechanics: an agent file has two loads, two readers, and a dispatch boundary.

The two loads are the **description** (permanent context load in every parent session that can spawn agents, read by the parent model deciding _whether_ to dispatch) and the **body** (the child's system prompt, read only by the spawned child, deciding _how_ to work). The two readers are the parent and the child; the dispatch boundary separates them. Every field decision follows from which reader a piece of text serves.

## Format

One markdown file per agent, YAML frontmatter then the body. User agents live in `~/.omp/agent/agents/<name>.md`; project agents in `.omp/agents/<name>.md`. Required frontmatter: `name`, `description`. The body is the child's system prompt.

```md
---
name: migration-auditor
description: Audit an applied database migration for reversibility, lock risk, and data-loss hazards. Use when reviewing a migration diff or before shipping a schema change.
tools: read, grep, glob, bash
model: "@review"
output:
  type: object
  properties:
    findings: { type: array, items: { type: string } }
    verdict: { type: string, enum: [ship, block] }
  required: [findings, verdict]
---

Audit the assigned migration against these hazards, in order:

1. …
```

## The description is a dispatch pointer

The description is the parent's only signal for choosing your agent over every other available one. It sits in the parent's tool description next to `scout`, `designer`, `reviewer`, `sonic`, and every custom agent — competing for the same dispatch. Write it as a context pointer: front-load the leading word, one trigger per branch, third person, two sentences — what it does, then "Use when …". It names the agent's role in a delegation, not its method.

Cap the branches the agent genuinely owns. A description claiming everything wins no dispatches the parent could route better; one claiming nothing is never picked. Compare the bundled agents' surface for calibration: _scout_ = read-only exploration, _reviewer_ = quality/security analysis of a diff, _sonic_ = strictly mechanical updates. Your agent earns its line by owning a slice none of those covers.

## The body is the child's system prompt

The child starts blank: no conversation history, no parent context beyond `task`, the batch `context`, and the workspace. The body carries everything the child must always hold — role, judgment standards, output shape, pitfalls. Anything the dispatch can supply per-invocation belongs in `task`/`context`, not the body: the body is the invariant, the dispatch is the variable.

Write steps with completion criteria per `writing-for-agents`. Sub-agent bodies pay the same premature-completion tax with less supervision — the parent sees only the yielded output — so completion criteria matter more here than in any other document: make the final output's acceptance checkable ("every finding cites file and line", "verdict is ship or block, never both").

State the tool contract the frontmatter grants: a read-only agent told to fix code stalls; a writing agent never told what to leave alone tramples it.

## Frontmatter levers

- `tools` — CSV or array; omit for the full default set. Restrict to harden the boundary (`read, grep, glob` for a read-only agent). `yield` is auto-added; `hub` is retained; `task` is auto-added only when `spawns` is declared and depth permits. Prefer restricting by `tools` over instructing restraint in the body.
- `spawns` — which agents this one may dispatch (`*`, CSV, or array). Omit unless the agent orchestrates its own children; recursion depth is capped (`task.maxRecursionDepth`, default 2).
- `model` — selector, CSV fallback chain, or `"@role"` alias resolved through `modelRoles`. Aliases decouple the definition from the deployment; concrete selectors pin it.
- `output` — JSON Schema for structured results. Use when the parent consumes the result programmatically; prose outputs need no schema.
- `autoloadSkills` — skill names from the parent session injected before the child's first prompt; for agents whose domain knowledge lives in an existing skill.
- `read-summarize: false` — verbatim file reads for agents that quote or diff exact content (scout/librarian ship this way).
- `thinking-level`, `prewalk`, `advisor`, `blocking` — see Cost and lifecycle tuning.

## Model routing

A dispatch resolves the child's model by precedence: `task.agentModelOverrides[agentName]` in settings → the frontmatter `model` list → the parent's active model. Role aliases (`"@review"`) expand through `modelRoles` at either of the first two rungs.

The decision is alias versus concrete selector. An alias (`model: "@review"` plus `modelRoles: { review: openai/gpt-5.4:high }` in `config.yml`) decouples the definition from the deployment: remap the role once and every agent on it moves; share the agent file and each environment picks its own model. A concrete selector pins behaviour — right when the agent's quality bar _is_ the model (a security reviewer that must not silently downgrade), wrong when it fossilizes a model name into a shared definition. A CSV chain (`model: "@review, openai/gpt-5-mini"`) degrades gracefully: first unavailable selector falls through to the next.

Default to inheriting (no `model` field) unless the agent has a real cost or quality constraint; add an alias when it does; pin a selector only when the constraint is a floor.

## Cost and lifecycle tuning

Reach for these when measurement shows the need, not speculatively:

- `thinking-level` (or `thinking`) — pins effort. A mechanical agent on `low` saves real tokens; an analysis agent capped below its task's difficulty yields shallow output that reads as done. Omit to inherit.
- `prewalk: true` (or `"@smol"`) — starts on the resolved model, hands off to a cheaper one at the first edit/write. For agents whose expensive work is reading and deciding, with the writes being mechanical. Useless for read-only agents — no edit ever fires the hand-off.
- `advisor: true` (or a model pattern) — pairs the child with an advisor on the `advisor` role model for mid-run consultation. Subagents default to none; opt in when the agent makes irreversible calls a second opinion cheapens.
- `blocking: true` — the parent waits even under async dispatch. For agents that are sequential steps in a flow (audit → fix), not parallel branches; a blocking agent in a fan-out serializes it.

Isolation is a dispatch-side control (`isolated` per task item, `task.isolation.mode` in settings), not a frontmatter field — an agent that _needs_ isolation says so in its description's trigger branches so the parent dispatches it isolated.

## Discovery and precedence

Discovery merges, first-wins by exact `name`: project `.omp/agents/` → user `~/.omp/agent/agents/` → extension/plugin `agents/` dirs → bundled agents. A project agent shadows a user agent; any custom agent shadows a bundled one of the same name — shadowing `scout` or `reviewer` is a deliberate override, never an accident to debug later. Names are case-sensitive; one malformed file is skipped with a warning and never aborts the rest.

An agent can be discoverable yet unspawnable: disabled in `task.disabledAgents`, denied by the parent's `spawns` policy, blocked as self-recursion, or past the recursion cap. Unknown-name failures list the available agents — that list is the ground truth for what the parent could see.

## Review checklist

- [ ] Description front-loads the leading word and lists each trigger branch once
- [ ] Description claims only the slice the agent owns — no overlap with bundled agents it can't beat
- [ ] Body assumes zero conversation history
- [ ] Body's final step ends on a checkable, exhaustive completion criterion
- [ ] `tools` matches what the body instructs
- [ ] Per-invocation variables live in `task`/`context` examples, not the body
- [ ] `output` schema exists exactly when the parent parses the result
- [ ] Model choice is deliberate: inherit, alias, or pin — not defaulted to a pin
- [ ] Tuning fields (`prewalk`, `advisor`, `thinking-level`, `blocking`) each answer a measured need
- [ ] Name is unique across project, user, and bundled agents — or the shadowing is intended
