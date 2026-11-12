---
name: research
description: Investigate a question against primary sources and record cited findings in a Markdown file. Use for delegated reading legwork, official docs or API facts, and decisions that need evidence. Answer a quick lookup directly instead.
---

# Research

Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.

## Scale the work

- Tiny, answerable in a few reads → answer inline with citations; no file.
- Broad, multi-source, or explicitly delegated → write findings to one Markdown file.
- Delegate to a background subagent when the reading is large or parallelizable; otherwise do it inline. When delegating, give the subagent the full question, source bar, and destination.

## Record the findings

1. Write one Markdown file. Save it where the repo already keeps such notes; match the existing convention. With none, put it somewhere sensible and say where.
2. Cite every claim at the point it appears: source URL plus the section, version, or commit that fixes the fact.
3. Mark what remains unknown, contradictory, or inferred instead of smoothing it into a confident answer.
4. Report the file path and the unanswered questions.

**Done when** the file exists at the reported path, every claim has a primary source, and unresolved points are listed.

Without a file (inline answer), the same citation and uncertainty rules apply.
