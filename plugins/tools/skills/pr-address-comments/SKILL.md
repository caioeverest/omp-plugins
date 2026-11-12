---
name: pr-address-comments
description: Work a pull request to green: fix failing checks, reply to every review thread, and resolve it.
disable-model-invocation: true
---

# Address PR Comments

Work a pull request until **two** end-conditions hold:

1. Every CI check passes (or is legitimately skipped).
2. Zero unresolved review threads.

Loop between the two. For each failing check: read the failure, fix the cause, push, re-poll. For each comment: verify it, then fix or rebut, push if needed, reply in-thread, resolve the thread.

## Identify the PR

Call `look_for_prs` (no arguments). It returns the current branch's PR and, for a stacked branch, the ordered layers with their PR numbers. Then call `get_pr_details` with `{ "pr": "<number>" }` for identity, checks, and comments.

If the bundled tools are unavailable, fall back to `gh`:

```bash
gh pr view --json number --jq '.number'
gh pr view --json number,title,body,baseRefName,headRefName,url
```

No PR for the branch: ask the user for a PR number or `OWNER/REPO` and stop. Resolve the repository identifiers once for the GraphQL calls (`.owner.login`, not `.owner`):

```bash
gh repo view --json owner,name,nameWithOwner --jq '.owner.login,.name,.nameWithOwner'
```

## Stance

Verify before agreeing, and agree before implementing. A review comment is a claim about your code, not a verdict: read it fully, restate it, check it against the current code, then decide whether it is right for *this* codebase before touching anything.

- **No performative agreement** — no "you're absolutely right", no "good catch", no thanks. State the fix, or make it and show the code.
- **No blind compliance either.** Push back with evidence when a suggestion breaks behavior, misreads context, contradicts a documented standard or an earlier decision, or asks for generality nobody needs — `grep` for real usage before "implementing it properly".
- **Any comment you do not fully understand halts the batch**: implement nothing, ask, then proceed. Two comments may share one cause, and a half-understood one gets implemented wrongly.
- **External reviewers may lack context.** Before rejecting a finding, ask whether it is right here, whether it breaks existing behavior, and why the code looks as it does.
- **When your pushback was wrong**, correct it in one factual line ("you were right — I checked X; it does Y") and move on. No apology loop, no defending.

## Process

### 0. Read check status, and loop until green

`get_pr_details` returns `checks.passing`, `checks.failed` (each with its failure log attached), `checks.pending`, and `checks.summary`. Use it for both the check pass and the comment pass.

Fallback:

```bash
gh pr checks <number> --json name,state,bucket,link,workflow
```

`bucket` is `pass`, `fail`, `pending`, `skipping`, or `cancel`.

- `fail` or `cancel` → read the log, fix the cause, commit, push.
- `pending` → wait; do not declare done while checks run.

```bash
gh run watch --exit-status <run-id>
gh run view <run-id> --log-failed
gh run view --job <job-id> --log
```

Fix the cause in code. Re-run only when the log proves an infrastructure or flaky failure, and say why:

```bash
gh run rerun <run-id> --failed
```

Every push retriggers CI: return here and wait for `pending` → terminal state. Repeat until every check is `pass` (or `skipping` where legitimately skipped).

### 1. List unresolved threads

`get_pr_details` shows all open comments with `path`, `line`, `resolved`, and `outdated`, but not the thread node IDs or comment database IDs needed to reply and resolve. Fetch those with GraphQL, paging until `hasNextPage` is false:

```bash
gh api graphql -f query='
query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100,after:$after){
        pageInfo{ endCursor hasNextPage }
        nodes{
          id
          isResolved
          path
          comments(first:1){ nodes{ databaseId body } }
        }
      }
    }
  }
}' -F owner=OWNER -F name=REPO -F number=PR_NUMBER \
  --jq '.data.repository.pullRequest.reviewThreads'
```

On the first request omit `after` (it defaults to null). On later pages pass `-f after=<endCursor>`. Filter `select(.isResolved == false)` and concatenate every page — 100 threads is a hard page cap, so a heavily reviewed PR is not done after one page.

Zero unresolved threads → skip to step 5, but still confirm checks are green.

### 2. Handle each unresolved comment

Read the whole body. The actionable recommendation is often after the last `</details>` or buried in an analysis chain — extract it before deciding. Re-read the current code first: comments may describe code that has already changed.

**Fix** when the finding is valid, the change is small and correct, and it does not contradict a documented standard.

1. Make the minimal change.
2. Stage only the files you changed, then commit naming what was fixed.
3. Confirm the branch and remote immediately before the first push; never force-push.
4. Push so the PR is current.
5. Reply with what changed and the commit SHA.
6. Return to step 0 — the push retriggered CI.

If the fix requires an architectural decision that is not yours, ask instead of guessing.

**Rebut** when the comment references old code, contradicts a documented standard, is a style preference the repo does not enforce, is technically wrong, or is out of scope. Change no code; reply with specific technical reasoning and, for out-of-scope items, suggest a follow-up issue.

When unsure: fix if low-risk; rebut if the change needs a larger design call.

### 3. Reply in-thread

Replies must attach to the original comment, not the PR timeline. Use REST with `in_reply_to`:

```bash
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments \
  -f body="REPLY_BODY" \
  -F in_reply_to=ORIGINAL_COMMENT_DATABASE_ID
```

Use the first comment's `databaseId` from that thread.

### 4. Resolve the thread

After the reply — and after the push when you fixed something — resolve with the thread node ID:

```bash
gh api graphql -f query='
mutation($id:ID!){
  resolveReviewThread(input:{threadId:$id}){
    thread{ isResolved }
  }
}' -F id=THREAD_NODE_ID
```

Resolve every thread you replied to, including rebuttals. If a comment is outside a diff thread and cannot be resolved, post a PR-level note documenting its disposition.

### 5. Verify and report

Re-check both end-conditions:

1. `gh pr checks <number> --json name,state,bucket` → no `fail`, no `pending`.
2. The GraphQL thread listing → `unresolved == 0`.

Loop steps 0–4 until both hold. Report the check status, comments fixed vs rebutted, and the PR URL.

## Rules

- **Done = green checks AND zero unresolved threads.** Neither alone is sufficient.
- **Every comment gets a reply.** Never resolve without replying; never reply without resolving.
- **Fix → commit → push → reply → resolve → re-check.** The reply cites the commit SHA, so the push comes first.
- **Rebut → reply → resolve.** No commit or push.
- **A failing check is also a comment:** read its log, fix the cause, push, re-poll.
- **Verify before acting.** Re-read the current file before fixing or rebutting.
- **Batch independent fixes; serialize ones that interact.**
- **Order the batch: clarify everything first, then blocking items, then simple, then complex** — testing each as you go, keeping the tree green.
- **Never force-push, rewrite history, or edit someone else's comment.**
- **A re-run that hides a real bug is a second bug.**