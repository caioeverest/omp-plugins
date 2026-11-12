---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea in rounds of interactive multiple-choice questions. Use to stress-test thinking, resolve a design, or on any "grill" request; also capture durable ADR/glossary docs when the decisions must be documented.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round, then wait for the answers before the next round.

## Ask a round with one form

The `ask` tool takes a single HTML `<form>` and returns the user's answers; the user fills the whole round in one pass and submits. Put every frontier question in that one form.

- One `<fieldset>` per question, its `<legend>` the question text. Two or more top-level fieldsets render as tabs with a Review tab to submit, so keep each question self-contained.
- Each question is a **radio group** — one `<input type="radio">` per option, all sharing one `name`. Put each option's tradeoff in the surrounding prose, not the label.
- Mark your recommended option `checked`: it starts selected, so the user's Enter walks the fast path straight to submit.
- Use a **checkbox group** (shared `name`) only when several options can hold at once.
- Never add an "Other" option: the UI appends a free-text `Other` row to every radio/checkbox group of two or more options. A `<select>` gets no such row — prefer radio groups.
- `required`, `min`/`max`, `pattern` are enforced; use them when an answer must be valid.

```html
<form>
  <fieldset>
    <legend>Where does the cache live?</legend>
    <label><input type="radio" name="cache" value="sqlite" checked> SQLite — one file, no service</label>
    <label><input type="radio" name="cache" value="postgres"> Postgres — shared, needs a server</label>
    <label><input type="radio" name="cache" value="in-memory"> In-process — fastest, lost on restart</label>
  </fieldset>
  <fieldset>
    <legend>…the next frontier question…</legend>
    …
  </fieldset>
</form>
```

## Work the tree

Each round's answers reshape the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open this round belongs to a _later_ round.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools), dispatch a sub-agent to find it — don't ask the user anything you can look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait; ask the rest of the frontier now. The _decisions_ are the user's — put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

## Capture the decisions (opt-in)

When the user wants the decisions kept — ADRs, a glossary, `CONTEXT.md` — run `/domain-modeling` alongside the interview: each settled decision sharpens the domain model. Record only settled decisions, and write the docs **after** the interview converges, never mid-round.
