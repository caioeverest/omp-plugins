---
name: delegated-implementation
description: Drive implementation through subagents — write a self-contained brief, dispatch one writer at a time, verify its report against the diff with a separate reviewer, then run a capped fix loop. Use when a parent session should stay a controller instead of editing code, when dispatched work needs a brief-and-verify loop, or when no single context can hold the whole job. Not for workspace isolation itself (worktree-parallel) or a one-off review (code-review).
---

# Delegated implementation

The parent session is a **controller**, not a second pair of hands. It writes briefs, dispatches one writer, verifies what came back through an independent reviewer, and decides. The moment the parent starts editing, it loses coordination context and skips review — the two things it exists for.

Isolating writers in separate checkouts is `worktree-parallel`; this skill is the loop around them.

## Roles

- **Writer** — a `task` subagent that implements exactly one brief, runs its own checks, commits, and reports.
- **Reviewer** — a separate, fresh, read-only subagent (`reviewer`) that judges the diff against the brief. Never the parent, never the writer.
- **Parent** — owns the plan, the rulings, the ledger, and every merge.

No role substitutes for another. A writer re-reading its own diff is not a review. A parent reviewing inline burns the context it needs to keep driving.

## Record the base first

Before dispatching anything, capture the commit the work starts from:

```bash
git rev-parse HEAD          # BASE — write it down
```

Every diff you hand a reviewer is `BASE..HEAD`. `HEAD~1` silently drops the other commits of a multi-commit task.

## The brief

The brief is the **single source of requirements**, written to a file (`local://brief-<task>.md` or a path in the repo) that the child reads. A child starts blank — no conversation, no memory of the other tasks — so the brief carries everything:

- Goal, and where this task sits in the wider plan.
- Scope and explicit non-goals: what not to touch.
- The decisions the child cannot make for itself: exact file paths, signatures, pinned values, test cases, interfaces it consumes and produces.
- The check that proves it works, and the command that runs it.
- The report contract (below).

Dispatch prompt carries only: one line of context, the brief path with "read this first, requirements are binding", cross-task interfaces the brief cannot know, your rulings on ambiguities, and the report path. Never paste accumulated history from earlier tasks — it is the parent's context you are trying to protect.

## Writer rules

- Read the brief first; requirements are binding, not advisory.
- Stay inside scope. Report what you noticed outside it instead of fixing it.
- Test-driven where a seam exists: the failing test first, then the fix (`tdd`).
- Run the check and read its output. A claim without output is a claim (`verifying-your-work`).
- Commit the work on the task branch; the parent owns merges.
- Do not dispatch your own reviewers or subagents — the review seat is already scheduled.
- Self-review the diff before reporting. It never replaces the official review.

## Report contract

Full detail goes to the report file; the returned message stays short:

```
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Commits: <sha..sha>
Tests: <one line — command and result>
Concerns: <one line each, or none>
Report: <path>
```

- `DONE_WITH_CONCERNS` — finished, with risks the reviewer must know.
- `NEEDS_CONTEXT` — the brief is missing something only the parent can rule on; nothing was guessed. Answer it and re-dispatch.
- `BLOCKED` — the task cannot proceed; state the blocker and what was tried.

## Verify, do not trust

The report is a **claim about the work, not the work**. Read the diff before acting on it.

Dispatch the reviewer with the brief, the report, and the diff as a file. The reviewer returns **two verdicts**, always both:

1. **Spec compliance** — every requirement in the brief: met, missed, or unverifiable.
2. **Quality** — defects in the change itself, each with a failure path.

Reviewer rules:

- Treat the change as suspect: verify the report's claims against the diff.
- Do not accept "left it out on purpose" as a reason to downgrade a finding — judge the effect.
- The reviewer's own constraints — read-only on the checkout, no subagents of its own, what it cannot check it flags rather than guesses, and every behavior it declined to judge listed one line each — are in `code-review`.
- Flagged items come back to the parent; the reviewer never resolves them itself.

Never pre-judge the review: no "don't flag X", no "at most minor", no telling it to skip checks the writer already ran. A review instructed toward a verdict is theatre.

## The fix loop

Triggers: a missed requirement, a quality defect, or a parent-confirmed flag. Minor observations go to the ledger, never into the loop.

- **Rounds 1–2** — resume the **same writer** with the findings verbatim; its context is still intact and cheaper to reuse than to rebuild.
- **Round 3** — dispatch a **fresh** writer (or reviewer pass) with the report file for history.
- **After three rounds** — stop fixing. Adjudicate each open finding: park it with a written ruling, rule the smallest change that unblocks the plan, or escalate to the user. Silent discards are forbidden.
- Every fix round ends with a **scoped re-review** by a fresh reviewer: verdict per finding (`ADDRESSED` / `NOT ADDRESSED`) plus new breakage in the fix diff only. New out-of-scope observations go to the ledger; they never extend the loop.
- The parent never fixes findings itself. If it must, the work re-enters as a normal dispatched task.

## Recording

The parent owns the record: one ledger line per completed task, and a ruling for every deviation. The `implement` skill defines the ledger format, the ruling format, and the four stops that interrupt work — one written record serves a single-session run and a dispatched one, so nothing is re-decided after a break. Adjudicating a finding after the loop cap is itself a ruling.

## Finishing

- Isolation, concurrent writers, and merge ownership are `worktree-parallel`'s rules: one writer per tree, one application at a time, the parent owning the branch and applying only a diff it has read.
- Close with one whole-branch review by a fresh reviewer. If it finds anything, one fix pass for the whole list, then one re-review. After that, residual findings escalate to the user instead of another wave.
- Grade findings by **effect**, not by the label the reviewer gave them.

## Anti-patterns

- Parent implements "because dispatching is overhead".
- Trusting a report; or letting a report's reasoning downgrade a finding.
- Reviewing inline, or letting the writer review itself.
- Skipping the re-review because "the fix was small".
- Two writers on one tree, or dependent tasks dispatched in parallel.
- Over-batching unrelated work into one writer; one writer per trivial edit.
- Pasting prior-task history into a dispatch instead of pointing at the brief.
- Telling a reviewer what not to flag.
- Adjudicating a finding before the loop cap, or dropping one without a ruling.
- Dispatching a child with no way to run the check itself.

## Done when

Every task has a brief on disk, a report, an independent review with both verdicts, and a ledger line; the fix loop never exceeded three rounds; no open finding lacks a written ruling; the branch's final state passed a fresh whole-branch review and a full-suite run (`verifying-your-work`).
