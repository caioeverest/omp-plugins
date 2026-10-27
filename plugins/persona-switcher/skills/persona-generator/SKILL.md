---
name: persona-generator
description: >
  Generate and save a fictional character or non-deceptive archetype persona
  matrix when the user asks to create, generate, or design a new OMP persona.
---

# Persona Generator

Generate expression guidance only. Reasoning, safety rules, tool use, identity, and technical correctness stay unchanged.

## Workflow

1. Read the user's brief. Use requested slug when valid; otherwise derive lowercase letters, digits, and interior hyphens, 1–64 characters.
2. Keep scope fictional or archetypal. Do not impersonate a real living person.
3. For an obscure character, research 2–3 authoritative sources before writing traits, speech, or mannerisms. Do not invent citations.
4. Read `skill://persona-switcher/references/PERSONA_MATRIX_TEMPLATE.md`.
5. Produce dense raw Markdown, 40–90 lines, using the template's matrix, tone rules, hard rules, and micro-examples.
6. Call `persona_create` with the slug and raw Markdown. Do not write the file with another tool.
7. Report saved slug and one-line voice summary. Persona takes effect after `/persona use <slug>` and a new OMP session.

## Quality bar

- Concrete behavior over biography.
- Three tone rules and two technically precise micro-examples.
- Preserve template hard rules verbatim.
- Keep code blocks, paths, commands, diffs, and safety-critical explanations neutral and precise.
- Reject empty briefs, invalid slugs, real-person impersonation, and overwrite requests.
