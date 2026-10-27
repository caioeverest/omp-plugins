---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea using interactive multiple-choice questions. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round via the `ask` tool, then wait for the answers before the next round.

## Asking with `ask`

Present each frontier question as an `ask` entry with **3 concrete options**, your recommended one first (marked via `recommended`). omp automatically appends an **"Other (type your own)"** choice, so the user can always free-type — never add your own "Other" option.

- One `ask` call carries the whole round's questions in its `questions` array — batch them, don't fire one question per call.
- Each question: a short `label` per option plus a `description` carrying the tradeoff. Keep labels terse; put the reasoning in the description, not the label.
- Set `recommended` (0-indexed) on your recommended option. The user just presses Enter to take it, moves to the next question, and submits at the end — that is the fast path you're optimizing for.
- Set `multi: true` only when several options can hold at once.

Round shape:

```
questions: [
  { id: "storage",    question: "…?", recommended: 0, options: [ {label: "SQLite", description: "…tradeoff…"}, {label: "Postgres", description: "…"}, {label: "Files", description: "…"} ] },
  { id: "auth",       question: "…?", recommended: 1, options: [ …3 options… ] },
  …one entry per frontier question…
]
```

The user walks the list pressing Enter on the choice they want (recommended is pre-highlighted) and submits on the last — far easier than typing out answers to a wall of numbered questions.

## Working the tree

Each round the user answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it — don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — ask the rest of the frontier now. The _decisions_ are the user's — put each to them (via `ask`) and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
