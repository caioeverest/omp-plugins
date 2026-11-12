---
name: code-review
description: "Review changed code with evidence. Use for a branch/PR/WIP review, \"review since X\", \"review my PR\", or \"is this PR ready\". Fixed-point mode compares a diff against Standards and Spec; PR mode adds Quality gates and Security/Correctness across four independent axes. Reports locally; posts or approves only when asked."
---

Review the diff between `HEAD` and a fixed point, or the pull request for the current branch. Pick one mode:

- **Fixed point** — the user names a commit, branch, tag, or ref (`main`, `HEAD~5`), or asks to review work-in-progress since one. Axes: **Standards**, **Spec**.
- **PR** — a PR exists for the current branch, or the user asks to "review my PR", "adversarial PR review", or "is this PR ready". Axes: **Intent**, **Standards**, **Quality**, **Security & Correctness**.

PR mode is adversarial: assume the PR has problems and try to find them. Both modes are read-only reviews — never commit, push, post a comment, approve, or request changes unless the user explicitly asks.

## Process

### 1. Pin the target

**Fixed point:** use whatever ref the user supplied. If they named none, ask. Verify it resolves and the diff is non-empty before spawning anything:

```bash
git rev-parse <fixed-point>
git diff <fixed-point>...HEAD       # three-dot: compare against merge-base
git log <fixed-point>..HEAD --oneline
```

**PR:** call `look_for_prs` (no arguments) to find the current branch's PR, then `get_pr_details` with `{ "pr": "<number>" }`. That returns identity, checks, and review comments. Capture the PR number, title, body, base ref, and URL. Get the diff and commits with `git fetch origin <base>`, `git diff origin/<base>...HEAD`, and `git log origin/<base>..HEAD --oneline`; for a fork or a branch not checked out, use `gh pr diff <number>` and `gh pr view <number> --json commits --jq '.commits[] | "\(.oid[0:7]) \(.messageHeadline)"'`. If no PR exists, stop, tell the user, and offer fixed-point mode instead.

### 2. Find the spec or intent

Look in this order: PR body; issue references in the PR body or commits (`Closes #123`, GitLab `!67`) fetched via the issue workflow in `docs/agents/issue-tracker.md` when present; a path the user supplied; a matching file under `docs/`, `specs/`, or `.scratch/`. If nothing exists, ask. If the user says there is none, the axis reports "no spec available" — in PR mode, review against the intent implied by the title, branch name, and commits.

### 3. Find the standards sources

List anything documenting how code should be written: `CONTRIBUTING.md`, `CODING_STANDARDS.md`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `docs/standards*`. Skip anything tooling already enforces. A documented repo standard overrides the smell baseline below.

The Standards axis always also carries this **smell baseline** (Fowler, _Refactoring_ ch. 3). Each item is a labelled heuristic ("possible Feature Envy"), never a hard violation:

- **Mysterious Name** — name hides purpose. → rename; if no honest name fits, the design is murky.
- **Duplicated Code** — same logic shape in several hunks/files. → extract the shared shape.
- **Feature Envy** — method uses another object's data more than its own. → move it onto that data.
- **Data Clumps** — same fields or params keep travelling together. → bundle them into one type.
- **Primitive Obsession** — primitive/string standing in for a domain concept. → give it a small type.
- **Repeated Switches** — same switch/if-cascade on the same type recurs. → polymorphism or one shared map.
- **Shotgun Surgery** — one logical change scatters edits across many files. → gather what changes together.
- **Divergent Change** — one module is edited for unrelated reasons. → split by reason to change.
- **Speculative Generality** — abstraction, params, or hooks the spec never needed. → delete and inline.
- **Message Chains** — long `a.b().c().d()` navigation. → hide the walk behind one method.
- **Middle Man** — mostly delegates onward. → remove it and call the real target.
- **Refused Bequest** — subclass ignores most of what it inherits. → use composition.

### 4. Spawn the axes in parallel

Run each selected axis as an independent sub-agent in one parallel batch. Give every sub-agent the same preamble: repo, branch, target/diff command, commit list, and these rules — adversarial stance, evidence for every finding (file + line/hunk and concrete impact), severity `blocker` / `major` / `minor`, no praise or padding, under 500 words. If parallel agents are unavailable, run the axes in separate passes and say so.

**Standards brief** — include the standards-source paths and the smell baseline above, pasted in full; the sub-agent cannot read this file. Report every diff violation of a documented standard (cite file + rule), any baseline smell (name it, quote the hunk), and divergence from surrounding-code idioms where no written rule exists. Baseline smells are always judgement calls.

**Spec (fixed) / Intent (PR) brief** — include the spec or PR body and linked issues. Report requirements missing or partial, scope creep nobody asked for, requirements implemented with wrong semantics/edge cases/defaults, and contradictions between the description and the diff. Quote the source line for each finding.

**Quality brief (PR only)** — the four gates are **Testing**, **Linting**, **Formatting**, **Generation**. Discover how this repo performs each one from Makefile targets, CI workflows, package scripts, and README/CONTRIBUTING; run only local, non-destructive commands. Never run a command that deploys, mutates shared or production state, or needs production credentials; report that gate as not run and why. Formatting and Generation mutate files: run them, record the diff, then restore the tree — the review must leave it unchanged. A gate with no mechanism in the repo is itself a finding ("gate absent"). Report each failing gate with trimmed error output, implicated changed files, and whether it already fails on the base branch (check the base in a temporary worktree, then remove it; never stash or discard the user's changes). Pre-existing = `minor`, new = `blocker`. Then judge the gates themselves: do the tests cover the defect classes this diff introduces (concurrency, auth, error paths)? A gate that passes but could not catch a real defect here is a `major` finding against the gate.

**Security & Correctness brief (PR only)** — report defects with a concrete failure path, not a bare "X can be nil". Cover correctness (nil derefs, races, swallowed errors, off-by-one, wrong error semantics, leaks/unclosed resources, context misuse), security (injection, hardcoded or logged secrets, unvalidated input crossing trust boundaries, authn/authz gaps, unsafe deserialization, dependency-manifest risk), and test gaps on risky paths. Redact secrets as `<REDACTED>`.

### 5. Aggregate

Present each axis under its own heading — `## Standards`, `## Spec` (or `## Intent`, `## Quality`, `## Security & Correctness`) — verbatim or lightly cleaned. Do not merge or rerank across axes.

- **Fixed point:** close with total findings per axis and the worst issue within each axis. Pick no single winner across axes.
- **PR:** close with a **verdict** — `APPROVE`, `APPROVE with comments`, or `REQUEST CHANGES`; any blocker means `REQUEST CHANGES`. Always name the top residual risk in one line, even for `APPROVE`, and present the verdict as a recommendation: the user merges. Add a table of axis | blockers | majors | minors | worst issue.

Treat red CI checks from `get_pr_details` as evidence; the Quality axis still runs the gates locally.

### 6. Deliver

Default to the conversation. Before any PR-facing action, ask which output the user wants:

1. **Local markdown** — write `./pr-review-<branch>-<date>.md` and give the path.
2. **PR comment** — only when explicitly requested: `gh pr comment <n> --body-file <file>`. Never use `gh pr review`; never record an approval or rejection in the PR's review state.
3. **Inline only**.

Finish with what was reviewed: target commit range, axes run, and checks executed.

Done when every selected axis has a report, every finding cites evidence and a severity, and the user has chosen where the review goes.

## Why the axes stay separate

A change can pass one axis and fail another: code that follows every standard but implements the wrong thing (Standards pass, Spec/Intent fail), or code that does exactly what was asked but breaks conventions (Spec/Intent pass, Standards fail). A PR can pass three axes and still deserve rejection. Separate reports stop one axis from masking another.

Adversarial does not mean hostile: findings are factual, evidenced, and actionable.