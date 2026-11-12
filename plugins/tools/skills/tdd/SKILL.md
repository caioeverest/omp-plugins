---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle — consult them before and during the loop, not after.

When exploring the codebase, read `CONTEXT.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists — and survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams — where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam. You can't test everything — agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

Ask: "What's the public interface, and which seams should we test?"

A seam that is hard to test is design feedback: an interface that needs everything mocked is too coupled — simplify it rather than mocking harder. Test-only cleanup belongs in test utilities, never on the production class.

When the shape of that interface is itself in question — how deep the module is, where the seam belongs, what the interface should expose — consult the `codebase-design` skill for the vocabulary. It is the shared source of the module, interface, depth, seam, adapter, leverage and locality terms: a reference, not a session to run.

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological** — the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth — a known-good literal, a worked example, the spec.
- **Horizontal slicing** — writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead — one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.
- **Change detector** — the test fails only when someone revisits a deliberate decision: a constant's value, a message's wording, a private structure. It fires on every redesign and sleeps through real bugs. Test the behavior that depends on the decision, not how the decision is spelled.
- **Testing the framework** — asserting that the router called the handler you registered, or that the ORM saved a row. Test your code's behavior at your boundary; when you need to pin a dependency's real shape, one narrow characterization test is the whole ask.

## Proving a test can fail

A test that never failed proves nothing — you have not shown it can catch anything. Make that checkable:

- **Name the break.** Before writing the body, name the production change that would make this test fail. If you cannot name one, the test asserts nothing observable — redesign it around behavior.
- **Mutate the code.** Mentally break the implementation — wrong constant, inverted branch, dropped side effect, skipped validation — and confirm at least one test fails per realistic mutation. Behavior no mutation catches is unprotected.
- **Fail for the right reason.** A test that errors out (compile failure, typo, missing fixture) is broken, not red. Fix it, re-run, and only then treat RED as established.
- **A bug fix's test earns its place by failing first** — the revert-and-watch-it-go-red proof lives in `verifying-your-work`.

## Rules of the loop

- **Red before green.** Write the test first, run it, and watch it fail for the expected reason. Then write only enough code to make it pass.
- **A test that passes before the change is not red.** Either it asserts the wrong thing or the behavior already exists — stop and fix the test or the premise before implementing.
- **Code written before its test is deleted.** Not kept as a reference, not adapted, not remembered. Delete means deleting — keeping it means the tests you write next are written after the fact while pretending otherwise.
- **Green means the whole suite.** Run the project's suite, not just your file: a red test you watched and did not report is a false report. Output stays pristine — warnings your change introduced are yours to fix.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle. Don't anticipate future tests or add speculative features.
- **A bug fix starts with a failing test that reproduces the bug** — never a fix first, with a test written alongside it.
- **Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill), not the red → green implementation cycle.

A cycle is done when the new test went red for the intended reason and is now green. The session is done when every agreed seam has coverage and the whole suite passes.

## When not to test

Throwaway prototypes, generated code, config values, and prose don't earn tests, and a one-line delegation to a framework isn't behavior. Anything else that ships does — ask before taking an exemption.
