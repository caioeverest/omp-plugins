---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go. Use when the user wants the grilling interview AND the durable documentation captured.
disable-model-invocation: true
---

Run a `/grilling` interview — read `skill://grilling` FIRST and follow its mechanics exactly: rounds via the interactive `ask` tool (2-5 multiple-choice questions per call, recommended first, "Other" auto-added), frontier recomputed each round, facts looked up yourself never asked from the user.

While the interview runs, also run `/domain-modeling`: each settled decision sharpens the domain model — candidate ADRs, glossary terms, CONTEXT.md updates. After the interview converges, write the durable docs per `/domain-modeling`: ADR(s) for decisions made, glossary/CONTEXT.md entries for vocabulary that emerged. Never write docs before the grilling finishes — record only settled decisions.

Rules:
- `ask` tool for ALL question rounds — never a numbered list in chat.
- Docs come AFTER convergence, from the interview's settled answers.
