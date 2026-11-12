---
name: improve-codebase-architecture
description: Scan a codebase for deepening opportunities, present them as a visual report, then work through the candidate you pick.
disable-model-invocation: true
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

Built on the `/codebase-design` skill (module, interface, depth, seam, adapter, leverage, locality — plus the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real") and the project's domain model: `CONTEXT.md` names good seams, ADRs in `docs/adr/` record decisions this command should not re-litigate.

## Process

### 1. Explore

**Scope before you scan — YAGNI.** Deepening a module pays off by making future changes to it easier, so weight the parts of the codebase that have recently changed.

- If the user named a direction — a module, a subsystem, a pain point — take it and skip the inference below.
- Otherwise walk back a good stretch of `git log --oneline` to find the hot spots — the files and areas that keep coming up — and let those paths pull your attention first. Scattered changes with no clear hot spot? Widen the net.

Read `CONTEXT.md` and any ADRs in the area first. Then spawn a sub-agent to walk the codebase, exploring organically and noting friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted for testability while the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? "Concentrates" is the signal you want.

### 2. Write the report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo: `<tmpdir>/architecture-review-<timestamp>.html`, resolving the temp dir from `$TMPDIR`, else `/tmp` (`%TEMP%` on Windows). Tell the user the absolute path.

Give each candidate a card — files, the problem, the solution in plain English, the benefits in terms of locality and leverage and how tests improve, a custom before/after visualisation, and a `Strong` / `Worth exploring` / `Speculative` badge. End with a **Top recommendation**. Use the `/codebase-design` vocabulary for the architecture and `CONTEXT.md` vocabulary for the domain: "the Order intake module", not "the FooBarHandler", not "the Order service".

If a candidate contradicts an existing ADR, surface it only when the friction is real enough to warrant revisiting the decision — mark the card clearly (e.g. _"contradicts ADR-0007 — worth reopening because…"_) rather than listing every refactor an ADR forbids.

See [HTML-REPORT.md](HTML-REPORT.md) for the scaffold, the full card spec, and the diagram patterns. Do NOT propose interfaces yet. Then ask: "Which of these would you like to explore?"

### 3. Work through the pick

Once the user picks a candidate, run the `/grilling` skill to walk the decision tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Record decisions inline as they crystallise, using the `/domain-modeling` skill:

- **Naming a module after a concept not in `CONTEXT.md`?** Add the term (create the file lazily if missing).
- **Sharpening a fuzzy term?** Update `CONTEXT.md` right there.
- **Rejecting the candidate for a reason a future review would need?** Offer an ADR: _"Want me to record this as an ADR so future reviews don't re-suggest it?"_ Skip ephemeral and self-evident reasons.
- **Want alternative interfaces for the deepened module?** Use `/codebase-design`'s design-it-twice parallel sub-agent pattern.
