---
name: write-an-agent
description: Create a new omp sub-agent definition — gather requirements, draft the agent file, review it with the user. Use when user wants to create, write, or build a new sub-agent.
disable-model-invocation: true
---

# Writing Agents

Before drafting, read `writing-agents` — the description/body contract, frontmatter levers, and precedence rules are there; this skill is the process.

## Where to save

Store user agents at `~/.omp/agent/agents/<name>.md` (always discovered, survives project changes). Store at `<repo>/.omp/agents/<name>.md` only when the agent is specific to one repo — say which you chose and why.

## Process

1. **Gather requirements** — ask:
   - What task does the agent own end-to-end? What slice does it take that `scout`, `reviewer`, or a plain `task` dispatch doesn't already cover?
   - Does it write or only read? Which tools does that imply?
   - Does the parent consume its output programmatically (structured `output` schema) or as prose?
   - Should it pick its own model (`model`/`@role`) or inherit the parent's?
   - Does it ever dispatch children (`spawns`)?
2. **Check for collisions** — list existing agents in `~/.omp/agent/agents/`, the project's `.omp/agents/`, and any extension/plugin `agents/` dirs. First-wins by exact name: your file shadows anything below it, including bundled agents.
3. **Draft the agent file** — one markdown file, frontmatter (`name`, `description` required) plus the body as the child's system prompt, per `writing-agents`.
4. **Review with the user** — present the draft and ask:
   - Does the description match when you'd reach for this agent?
   - Is the body's completion criterion checkable from the yielded output alone?
   - Anything the dispatch should supply per-run that's baked into the body, or vice versa?

## Draft template

```md
---
name: agent-name
description: One sentence on what it does. Use when [specific triggers].
tools: read, grep, glob        # omit for full default set
model: "@role"                 # omit to inherit the parent's model
output:                        # omit for prose output
  type: object
  properties:
    summary: { type: string }
---

[The child's system prompt: role, ordered steps, pitfalls, and a final
completion criterion the parent can check from the yielded output alone.]
```

## Verify

Run the static smoke check: `scripts/smoke-agent.sh <path-to-agent.md>` (frontmatter parses, required fields present, body non-empty, name collisions across project/user/bundled agents reported). Then spawn it once on a real task: `task` with `agent: <name>` and a `task` drawn from the description's trigger list. A good definition dispatches on the intended prompt and yields output matching the body's completion criterion without steering.
