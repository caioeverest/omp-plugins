---
name: pr-deep-review
description: Adversarial review of the PR for the current branch across four axes — Intent (did it solve what the PR set out to do?), Standards (does it follow the codebase's documented style and conventions?), Quality (do lint, tests, format, and code generation pass?), and Security/Correctness (bugs, footguns, vulnerabilities). Spawns independent sub-agent reviewers in parallel and aggregates a verdict. Use when the user asks to review the PR for the current branch, "adversarial PR review", "review my PR", or "is this PR ready".
disable-model-invocation: true
---

Adversarial review of the pull request corresponding to the current branch. Default stance: **skeptical**. Reviewers must prove the PR is correct, not assume it. Every axis tries to find reasons to reject.

Four axes, each an independent sub-agent with fresh context, run in parallel:

- **Intent** — the PR's stated goal (title, description, linked issue) vs what the diff actually does.
- **Standards** — conformance to this repo's documented coding standards (CLAUDE.md, CONTRIBUTING.md, CODEX.md, etc.).
- **Quality** — the four gates below, discovered from the repo, plus an evaluation of whether the gates themselves are doing their job.
- **Security & Correctness** — vulnerabilities and logical defects in the changed code.

## Process

### 1. Resolve the PR and the diff

Call `look_for_prs` (the bundled tool) to find the PR for the current branch (or the stack it's part of). Then call `get_pr_details <number>` for the PR identity, CI checks, and open comments. Capture the PR number, base ref, and body from the JSON.

Then get the diff:

```bash
git branch --show-current
git fetch origin <base>
git diff origin/<base>...HEAD
git log origin/<base>..HEAD --oneline
```

If the tool is unavailable, fall back to:

```bash
gh pr view --json number,title,body,baseRefName,headRefName,url,files
```

- No PR for the current branch → stop, tell user; offer `code-review` skill (fixed-point diff) instead.
- Confirm base ref resolves and diff is non-empty before spawning anyone.
- Save the full PR body — it is the Intent spec.

### 2. Gather context sources

- **Spec source**: PR body first. Then issue refs in PR body / commit messages (`Closes #123`) — fetch with `gh issue view <n>`. Both missing → Intent axis reports "no stated intent; reviewing against implied intent from branch name and commits".
- **Standards sources**: `CLAUDE.md`, `CONTRIBUTING.md`, `CODEX.md`, `AGENTS.md`, `docs/standards*`. List what was found; sub-agents may read them in full.
- **Quality gates — discover, never hardcode.** The four gates are **Testing**, **Linting**, **Formatting**, **Generation**. The skill names the gates; the repo decides how each is achieved. Typical commands a repo might use — `make test`, `make unit`, `make integration`, `make lint`, `make format`, `make gen` — are examples only. Before running anything, the Quality reviewer must inspect Makefile targets, CI workflows, package scripts, and README/CONTRIBUTING to learn how *this* repo performs each gate, then run it the repo's way. If a gate has no mechanism in the repo, that absence is itself a finding (gate not implemented).

### 3. Spawn four sub-agents in parallel

One message, four parallel agent calls. Fresh context each. Paste each its full brief — sub-agents cannot read this file.

**Common preamble for every sub-agent:**

- Repo, branch, PR number/title/URL, base ref, diff command, commit list.
- Adversarial stance: assume the PR has problems; your job is to find them with evidence. No praise, no padding.
- Every finding must cite file + line (or hunk) and explain impact. No speculative hand-wringing — reproduce or reason concretely.
- Rate each finding `blocker` (must fix before merge) / `major` (should fix) / `minor` (nit, optional).
- Under 500 words.

**Intent reviewer brief:**

- Full PR body + linked issue contents.
- Report: (a) stated requirements missing or partial in the diff; (b) scope creep — behaviour nobody asked for; (c) requirements implemented but implemented wrongly (wrong edge cases, wrong defaults, wrong semantics); (d) contradictions between PR description and diff. Quote the PR/issue text for each finding.

**Standards reviewer brief:**

- List of standards-source files (read them).
- Report: every place the diff violates a documented standard — cite the standard (file + rule) and the offending hunk. Also flag divergence from surrounding-code idioms where no written standard covers it (e.g., this repo: FX module pattern, `configx.Provide[T]`, full GitHub import paths, MySQL-first, `-short` guard on integration tests). Skip anything tooling already enforces. Distinguish hard violations from judgement calls.

**Quality reviewer brief:**

- First, map the gates: read Makefile/CI/scripts and state, for each of Testing / Linting / Formatting / Generation, exactly which command the repo uses to satisfy it — or "gate absent in this repo".
- Then run each gate the repo's way and report raw results. Formatting must end as a no-op (run formatter, then `git diff --exit-code`); Generation must leave a clean tree (run generator, then `git status --porcelain`).
- Report: each failing gate with the exact trimmed error output, which changed files it implicates, and whether the failure pre-exists on base (`git stash`, re-run on base if unsure) — pre-existing = `minor`, new = `blocker`.
- **Gate-value evaluation** (required, not optional): for each gate, judge whether it provides the value this PR needs — axes run in parallel, so base the judgement on the defect *classes* this diff introduces (e.g., concurrency changes demand race coverage; auth changes demand negative tests). The aggregator cross-checks: if other axes found defects that a passing gate should have caught, cite that as evidence the gate is inadequate. Weak spots to probe: tests that only cover happy paths for the changed code, coverage absent for the riskiest hunks, linters disabled on changed files, generated code committed without a freshness check in CI. A gate that passes but would not have caught a real defect in this PR is a `major` finding against the gate itself ("Testing gate inadequate for this change class").

**Security & Correctness reviewer brief:**

- Report defects in the changed code: (a) correctness — nil derefs, race conditions, error swallowing, off-by-one, wrong error semantics, resource leaks (unclosed rows/bodies, leaked goroutines, context misuse); (b) security — injection (SQL/command/template), secret handling (hardcoded creds, logged secrets), unvalidated input crossing trust boundaries, authn/authz gaps, unsafe deserialization, dependency risk in `go.mod`/`go.sum` changes; (c) test gaps where the risky code paths have no coverage. Trace at least one concrete failure scenario per finding — "X can be nil" is not enough; show the path that makes X nil.

### 4. Aggregate into verdict

Present each axis under its own heading — `## Intent`, `## Standards`, `## Quality`, `## Security & Correctness` — verbatim or lightly cleaned. Do not merge or rerank across axes.

End with:

- **Verdict**: `APPROVE` / `APPROVE with comments` / `REQUEST CHANGES` — driven by worst finding in any axis (any blocker → REQUEST CHANGES). **Never auto-approve unconditionally**: every verdict must name its top residual risk in one line, even for `APPROVE`, and be presented to the user as a recommendation, not a decision. The user merges; the skill only advises.
- Table: axis | blockers | majors | minors | worst issue (one line).
- One-line rationale per axis verdict.

### 5. Deliver the review

Ask the user which output they want; never post anywhere unprompted:

1. **Comment on the PR** — `gh pr comment <n> --body-file <file>` (a comment, **not** `gh pr review` — the skill advises, it does not record an approval/rejection in the PR's review state).
2. **Local markdown file** — write the full review to `./pr-review-<branch>-<date>.md` in the current folder and give the user the path.
3. **Inline only** — leave it in the conversation.

## Notes

- A PR can pass three axes and still deserve rejection — report axes separately so one failure isn't masked.
- Adversarial ≠ hostile tone. Findings are factual, evidenced, actionable.
- **No automatic approvals.** Even a clean four-axis pass yields `APPROVE` with a stated residual risk, delivered as advice to the user — never as a PR approval action without the user's explicit say-so.
- **Gate quality is part of PR quality.** Passing a gate that wouldn't catch this PR's bugs is not a pass — flag the gate.
