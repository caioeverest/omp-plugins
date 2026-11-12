# Testing a skill

[`writing-for-agents`](SKILL.md) holds that an instruction is a no-op until it changes behaviour versus the default — so the only way to know a document works is to watch an agent with it and without it. This is the branch for that check.

## Baseline first

Before writing much, run the task **without** the skill and record what the agent does: which choice it makes, what it skips, and the words it uses to justify skipping. That record is the specification of what the skill must change — and the reason to build the evaluation before the documentation.

If the baseline already behaves, stop. The guidance would be a no-op, and no amount of polish makes a no-op load-bearing.

## Red → green → refactor, on the document

- **Red** — run realistic scenarios with no skill. Log the choice and the rationalizations verbatim.
- **Green** — write the minimum skill that addresses only what the baseline got wrong. Re-run the same scenarios; compliance is the pass condition.
- **Refactor** — collect the *new* rationalizations the skill produced, add one countermeasure each (a rule, a table row, a red flag, a description symptom), re-run, and verify again.

Each round changes the document, never the scenario: identical prompts, run again, are what make rounds comparable.

## Scenarios that test anything

- Give the agent a realistic system prompt and real file paths. A toy prompt tests the prompt.
- Apply at least three pressures at once — time ("we ship in an hour"), sunk cost ("you already wrote it"), authority ("the user asked for it"), exhaustion ("just this once"). A single pressure is a scenario the default already passes.
- Offer concrete options with consequences, and ask **what do you do**, never "what should you do" — the second tests the skill's text, not the agent.
- Run several trials and read the flagged matches by hand. **Variance is the metric**: wording that converges behaviour is binding; wording that leaves outcomes scattered is not yet doing work.

## Micro-test the wording in doubt

One fresh agent per call, one sentence under test, five or more repetitions, and read what comes back. This is cheaper than a full scenario and it is how a pointer or a single rule gets its wording settled.

## What passing looks like

- The agent makes the right call under maximum pressure.
- It cites the skill — a section, a rule — as its reason rather than agreeing in general.
- It names the temptation and complies anyway.
- Asked how the skill could have been clearer, it reports a clarity problem, not disagreement with the rule.

Failing: new rationalizations, an argument that the skill is wrong, an invented hybrid approach, or asking permission while arguing toward the violation.

## Pure reference needs retrieval testing instead

A skill that is all reference — a glossary, a format guide, an API note — has no rule to violate, so pressure scenarios tell you nothing. Test **retrieval and application**: give an agent a task that needs the fact, and check it finds the document and uses it rather than inventing an answer. Discipline testing applies only where a rule can be skipped.
