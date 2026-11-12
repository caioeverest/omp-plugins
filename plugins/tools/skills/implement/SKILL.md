---
name: implement
description: "Implement a piece of work from a spec or set of tickets, driving it to a green, reviewed, committed branch."
disable-model-invocation: true
---

# Implement

The plan already did the thinking. Execute it exactly, prove each step, and leave a record that survives your own forgetting.

## The loop

1. Build with `/tdd` at the seams the spec pre-agreed.
2. Run every command the step names and read its output — never infer a pass from the diff looking right (`/verifying-your-work`). Run typechecking and the touched test files as you go, and the full suite once at the end.
3. When output does not match the step's expectation, classify it: a **code bug** goes to `/diagnosing-bugs` — never patch the symptom to make the output match; a **plan defect** gets the smallest change that still satisfies the spec, recorded as a ruling.
4. Work bigger than one context, or work you should not do inline? Drive it through subagents with `/delegated-implementation`.
5. Review the finished diff with `/code-review`, and fix what it surfaces — telling repairable findings from noise is the review's job, not a reason to skip it.
6. Commit to the current branch.

## Ledger

Conversation memory does not survive compaction, and a todo list is a live view rather than a record. Keep a ledger — the todo list is fine as long as it survives — with one line per completed task, written in the same turn as the commit:

```
Task N: complete — commits <base>..<head> — <check command>: <result>
Ruling: <what was decided> — <why> — <what it costs if wrong>
```

After a break, trust the ledger and `git log` over recollection. Deviating from the plan without a ledgered ruling is a decision made in secret.

## Rulings, not stalls

Conflicts, ambiguities and plan defects are yours to settle: the spec is the binding authority, the plan is its argument, and your judgement decides what neither answers. Record the ruling and keep moving — do not stop to check in between tasks.

Stop for exactly four things:

1. An irreversible or destructive operation.
2. A security-sensitive change.
3. A side effect outside the workspace — pushing a shared branch, publishing, deploying.
4. A plan so broken that every path forward is a guess.

## Completion contract

All of these, with evidence from this session — never inferred (`verifying-your-work` holds the general rule):

- Every command the plan names ran, and its output was read.
- The full suite passes on the final tree, not on an earlier one.
- Every step's expected output was compared with what actually printed.
- Every deviation carries a ruling.
- The review's findings were addressed, or each rejection has reasoning.
- The work is committed, and the tree is clean apart from the commit itself.

## Finishing the branch

Run the project's **full** suite before offering any way to land the work. Red is a stop, not a menu: report the failures and fix them first — a green run only proves the tree it ran on.

- Confirm the **base branch** before merging anything; a wrong base is expensive to unwind.
- After a local merge, **re-run the tests on the merged result**. If it fails, stop and leave the branch intact — the merge is local and recoverable.
- Clean up only checkouts and branches this work created, following `worktree-parallel`'s cleanup rules.
- A rejected push means the remote moved. Investigate; never force-push without an explicit request.

Stacked work lands through `/gh-stack`; a red PR comes back to green under `/pr-address-comments`, which only the user can start.

## Done when

The completion contract holds, the branch is green on its final tree, the branch itself is committed, and every step of the plan is either executed or has a ledgered ruling explaining why it is not.
