# Skill mechanics

The skill-specific branch of [`writing-for-agents`](SKILL.md): what changes when the document is a skill — creating one, frontmatter, the invocation choice, and router skills. Everything else about writing it is the universal reference in `SKILL.md`.

## Creating a skill

**Where to save.** User-level `~/.omp/agent/skills/<skill-name>/SKILL.md` — always discovered, survives project changes. Project-local (`<repo>/skills/<skill-name>/SKILL.md`, or `plugins/<plugin>/skills/<skill-name>/SKILL.md` for a bundled skill) only when the skill is specific to one repo; confirm the project's discovery covers that path and say which you chose.

**Process.**

1. **Gather requirements** — the task and domain the skill covers, the use cases it must handle, whether it needs executable scripts or only instructions, and any reference material to fold in. Include the **baseline**: what an agent does today without the skill, observed rather than assumed (see [`TESTING-SKILLS.md`](TESTING-SKILLS.md)) — that, not your intention, is what the skill has to change.
2. **Draft** — `SKILL.md` with the frontmatter and shape below; push reference into sibling files as the body grows (see _When to split_ in `SKILL.md`).
3. **Review with the user** — does it cover their cases? anything missing or unclear? should any section be more or less detailed?

**Template.**

```md
---
name: skill-name
description: What the skill does. Use when [specific triggers].
---

# Skill name

## Quick start

[Minimal working example]

## Workflows

[Ordered steps, each ending on a checkable completion criterion]

## Advanced features

[Link out: see [REFERENCE.md](REFERENCE.md)]
```

**Description.** The description is the agent's only signal for choosing this skill, so it is the skill's context pointer: front-load the leading word, third person, first sentence what it does then "Use when [specific triggers]" (wording rules in `SKILL.md`; branch collapse included). A **user-invoked** skill keeps a human-facing one-line summary instead — see _Invocation_ below.

Two traps. **A description that summarises the workflow gets executed instead of the skill**: an agent reading "two reviews between tasks" does one review and never opens the body, so say what the skill is for and when to reach for it, never the steps. And **keywords belong to branches, not synonyms**: name the symptoms, error strings, and verbs a user would actually say, one per genuinely distinct branch — the branch-collapse rule still holds, so this is not licence to pile up near-synonyms.

**Ship scripts** when the operation is deterministic (validation, formatting), the same code would be regenerated each run, or errors need explicit handling: a script is cheaper and more reliable than generated code.

Shape a script as **validate → act → report**: check its inputs and preconditions, do the thing, print the result the skill's completion criterion needs. Justify every constant in it — a magic percentage is a calibration knob someone will need later — and say whether the skill runs the script or reads it. A script whose output nobody checks is decoration.

**Name** the skill verb-first or as a gerund (`diagnosing-bugs`, `verifying-your-work`), one concept per name, and unique across every discovered skill.

**Review checklist.**

- [ ] Description carries the trigger branches ("Use when …")
- [ ] Body is lean — reference pushed to sibling files once it grows past ~100 lines
- [ ] Steps end on checkable completion criteria
- [ ] No time-sensitive statements
- [ ] One term per concept; concrete examples included
- [ ] Links resolve, and point one level deep
- [ ] Description states what the skill is for and when to reach for it — never the workflow's steps
- [ ] One excellent runnable example, not several, and no multi-language dilution
- [ ] Rules carry the load; no war stories, session logs, or metrics standing in for a rule

## Invocation

Two choices, trading the two loads:

- A **model-invoked** skill keeps a `description`, so the agent can fire it autonomously — and other skills can reach it. You can still type its name: model-invocation always _includes_ user reach; a description only ever adds agent discovery, never removes the human's. The description is the skill's top-level context pointer, forced to stay loaded at all times — permanent context load in exchange for discoverability. A model-invoked skill whose content is all reference is also one home for shared reference: another skill can invoke it, so reference needed by several skills lives in one place. Mechanics: omit `disable-model-invocation`, and write a model-facing description carrying the trigger branches (the pointer-writing rules in `SKILL.md` apply in full).
- A **user-invoked** skill strips the description from the agent's reach: only the human typing its name can invoke it, and no other skill can. Zero context load, but it spends cognitive load — you are the index that must remember it exists. Mechanics: set `disable-model-invocation: true`; the `description` becomes human-facing — a one-line summary, trigger lists stripped.

Pick model-invocation only when the agent must reach the skill on its own, or another skill must. If it only ever fires by hand, make it user-invoked and pay no context load.

Shared reference that two user-invoked skills both need can live in neither — with no descriptions, neither can fire the other. Push it to a plain file outside the skill system: external reference any skill can point at.

## Splitting by invocation

The invocation cut of splitting (the sequence cut lives in `SKILL.md`): split off a model-invoked skill when you have a distinct leading word that should trigger it on its own — a trigger word you actually use in your prompts — or another skill must reach it. You pay context load for the new always-loaded description, so that independent reach has to be worth it.

## Router skills

When user-invoked skills multiply past what you can remember, that piled-up cognitive load is cured by a **router skill**: one user-invoked skill that names the others and when to reach for each, so the human has one skill to remember instead of many. It can only hint, never fire them: user-invoked skills have no description, so nothing but the human can reach them.
