---
name: implement
description: "Implement a piece of work from a spec or set of tickets, driving it to a green, reviewed, committed branch."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

1. Build it with `/tdd` at the seams the spec pre-agreed.
2. Run typechecking and the touched test files as you go; run the full test suite once at the end — it must pass.
3. Review the finished diff with `/code-review` and address what it surfaces.
4. Commit to the current branch.

Done when the tests pass, the review is addressed, and the work is committed.
