---
name: to-tickets
description: Break a plan, spec, or the current conversation into tracer-bullet tickets, each declaring its blocking edges, and publish them to the tracker (beads) with native blocking links. Use when the user wants the work split into implementable tickets; use `/to-spec` first when there is no spec yet.
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets** — tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-repo` if not.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first
- **Right-size each ticket** — the smallest unit that carries its own test cycle and is worth a reviewer's gate. Fold setup, config, and scaffolding into the ticket that needs them. Split only where a reviewer could reject one ticket while approving its neighbour.
- **Give each ticket its interfaces** — what it consumes and what it produces, with the exact names and signatures. An implementer sees only their own ticket, so nothing else can supply them.
- **Each step a ticket names is one action with a checkable result** (write the failing test / run it, watch it fail / implement / run the tests / commit), and a verification step names both the command and the output that means it passed.
- **Pin the values once, at the top** — the spec's constraints, constants, and signatures verbatim, so every ticket inherits the same ones.

</vertical-slice-rules>

Give each ticket its **blocking edges** — the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket — green is promised only there.

Self-check the breakdown before presenting it — yourself, not with a subagent:

- Every requirement in the spec is covered by exactly one ticket.
- Interfaces agree across tickets: nothing consumes a name that no ticket produces.
- No decision-free lines: no `TBD`, no "handle edge cases", no type whose definition lives in nobody's ticket.
- Proportion: a breakdown several times longer than the spec has become a transcript of your thinking — cut it back.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets to beads, the task manager `/setup-repo` configured:

- **beads (`bd`) — this repo's task manager** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers: `bd create "<title>" -t task --json`, then wire dependencies with `bd dep add <blocked-id> <blocker-id>` (or `--deps 'blocks:<id>'` at creation). Tasks may depend on each other — `bd ready` only surfaces tickets whose blockers are all closed, so agents always pull workable items. Apply the `ready-for-agent` label (`bd label add <id> ready-for-agent`) unless instructed otherwise — the tickets are agent-grabbable by construction.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue.

<issue-template>

## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective — not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Files

- The files this ticket creates or modifies, and what each is for.

## Interfaces

- **Consumes**: the names and signatures this ticket relies on from other tickets.
- **Produces**: the names and signatures other tickets may rely on.

## Review focus

- The input classes or failure modes most likely to bite this ticket, each with the test that covers it.

## Blocked by

- A reference to each blocking ticket, or "None — can start immediately".

</issue-template>

In the ticket body, keep line numbers and code snippets out — they go stale fast. File paths and interface names are the deliberate exception: an implementer sees only their own ticket, so the files it touches and the signatures it must match have to be in it. Exception to the exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.
