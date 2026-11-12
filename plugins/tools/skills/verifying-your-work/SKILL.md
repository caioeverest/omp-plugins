---
name: verifying-your-work
description: Verify work before claiming it is done — run the proving command, read its real output, and report what actually happened. Use before any completion claim ("done", "fixed", "passing", "works"), before reporting a task finished, and when checking a subagent's success report or a CI-green claim. Not a review of the change itself (code-review).
---

# Verifying your work

A claim of success is a factual claim about a command that ran. It is true only if you ran it, in the turn you make the claim, and read what it printed.

## The gate

Before every status claim, in order:

1. **Name the proof** — the one command or observation that separates done from not-done: the failing test, the build, the actual run, the diff, the rendered screen.
2. **Run it fresh** — not the earlier run, not a narrower one, on the current tree.
3. **Read the whole output** — exit code, failure count, the lines you did not expect.
4. **Check it confirms the claim** — `0 failures` for "tests pass", `exit 0` for "it builds", the user's symptom gone for "fixed", every requirement ticked against the request for "complete".
5. **Then claim**, quoting the evidence.

Skipping a step is how a false success claim is born. The claim and its evidence travel together: a conclusion without the command that produced it is a guess wearing a costume.

## What does not count

- **Extrapolation** — an earlier run, a partial run, a run on a different tree, or "the change is small".
- **Syntax words** — "should work", "probably fine", "seems to", "looks correct", "that ought to". Compilation success proves compilation; a linter passing is not compilation.
- **Satisfaction before evidence** — "done!", "great, that's fixed" written before the command ran.
- **A subagent's report** — a dispatched agent's "tests pass" is a claim about its own work. Read the diff and the test output yourself.
- **The absence of an error** — silence is not a passing suite unless you ran the suite.
- **"Just this once."** The exception is always the case that was actually broken.

## Evidence per claim

| Claim | Evidence |
| --- | --- |
| Tests pass | The test command's output: `N passed, 0 failed`, not the command's presence |
| It builds / compiles | The build command exiting 0 |
| A bug is fixed | The original symptom re-run and gone, plus a regression test that went red before the fix and green after |
| Requirements met | A line-by-line walk of the request against the change — not "tests pass" |
| CI is green | The check's own terminal state, not its earlier state |
| The UI works | The real surface observed fresh — a screenshot, a run, an accessibility read |

A regression test proves nothing until you have watched it fail: revert the fix, watch it go red, restore, watch it go green. Otherwise you have written a test that may never have been able to catch anything.

## When you cannot verify

State the exact gap: what you ran, what it showed, and what you could not check — then let the claim shrink to what the evidence supports.

- "Unit tests pass; the migration was not run against a real database."
- "The handler is exercised by the test suite; the deployed endpoint was not called."

Naming a limitation is honest and useful. Converting it into a success claim is not. Ask for the access, artifact, or environment that would close the gap when it is the only way forward.

## Calibrate the wording

The rule covers implications, not just vocabulary. "It works now", "that's handled", "should be fine in production" carry the same claim as "tests pass" and need the same evidence. When the evidence is partial, say exactly which part is proven and which is inferred.

## Done when

Every status claim in your report is backed by a command you ran in that turn, its output is quoted, and every unverified item is named as unverified. A report with no unsupported success claim passes this skill — a short report of partial, honest verification beats a confident, unearned summary.
