---
name: pr-address-comments
description: Address all unresolved review comments and failing CI checks on a pull request. Use when the user wants to address PR comments, reply to reviewer feedback, fix failing PR checks, or work a PR until all checks pass and zero unresolved threads remain.
disable-model-invocation: true
---

# Address PR Comments

Work a pull request until **two** end-conditions hold: (1) every CI check is passing, and (2) zero unresolved review threads. Loop between fixing check failures and addressing comments until both are green. For each comment: reply (rebut or fix), push if needed, reply on the thread, then resolve the thread. For each failing check: read the failure, fix the cause, push, re-poll.

## Identify the PR

Call `look_for_prs` (the bundled tool) — it reports the current branch's single PR (with its number) and, when the branch is stacked, the ordered gh-stack layers with each layer's PR number/title/state. Use the PR number it returns; fall back to `gh pr view --json number --jq '.number'` only if the tool is unavailable.

If the tools are unavailable, fall back to `gh`:

```bash
gh pr view --json number --jq '.number' 2>/dev/null
```

If that returns nothing, there's no PR for the current branch — ask the user for the PR number (or repo `OWNER/REPO` + number) and stop. Also resolve `OWNER`/`REPO`/`REPO_FULL` from the git remote so the GraphQL calls have the values they need (note: `.owner.login`, not `.owner` — `gh repo view --json owner` returns the owner object, and the GraphQL/REST calls need the login string):

```bash
gh repo view --json owner,name,nameWithOwner --jq '.owner.login,.name,.nameWithOwner'
```

## Process

### 0. Read the check status (and loop until green)

Before and after addressing comments, read the PR's CI status. A green-thread / red-check PR is not done.

Fastest: call `get_pr_details` — it returns PR identity, `checks.passing` / `checks.failed` (each with its failure log already attached) / `checks.pending`, a `checks.summary`, and all open comments in one JSON payload. Use it for both the check pass (step 0) and the comment pass (step 1).

Fallback `gh`:

```bash
gh pr checks PR_NUMBER --json name,state,bucket,link,workflow
```

- `bucket` is one of `pass`, `fail`, `pending`, `skipping`, `cancel`.
- If any check is `fail` or `cancel`: get the failure detail (below), fix the root cause, commit, and push.
- If any check is `pending`: poll — do not declare done while checks are running.

Watch the run until it settles:

```bash
# Follow the failing run live; exits when the run completes
gh run watch --exit-status RUN_ID
```

Get the failing log for a run (prefer `--log-failed` to see only failing steps):

```bash
gh run view RUN_ID --log-failed
# or for a specific job:
gh run view --job JOB_ID --log
```

Fix the cause in code — never just re-run to dodge a real failure. Re-run only for a genuinely flaky/transient failure after confirming the log shows infrastructure, not a code bug:

```bash
gh run rerun RUN_ID --failed
```

After pushing a fix, re-run `gh pr checks` and wait for `pending` → terminal state. Repeat until every check is `pass` (or `skipping` where legitimately skipped).

### 1. List unresolved threads

Use `get_pr_details` for the full comment picture. To also get the thread node IDs (needed to resolve) and inline comment database IDs (needed to reply), use the GraphQL API. Page through results — `reviewThreads(first:100)` caps at 100 per page, so on heavily-reviewed PRs you must follow `pageInfo.endCursor`/`hasNextPage` to avoid silently omitting threads:

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
}
' -F owner=OWNER -F name=REPO -F number=PR_NUMBER -f after=null \
  --jq '.data.repository.pullRequest.reviewThreads'
```

Loop while `hasNextPage` is true, passing `endCursor` as `-f after` on the next call. Filter `select(.isResolved==false)` per page. Concatenate all pages before processing.

If zero unresolved threads, skip to step 5 (final verify) — but still confirm checks are green.

### 2. For each unresolved comment

Read the comment body in full (the first 500 chars are usually the headline; the recommendation is often inside a `<details>` block — extract it). Decide per comment: **fix** or **rebut**.

Verify each finding against the current code before acting. Fix only still-valid issues; skip the rest with a brief reason. Keep changes minimal.

#### Branch a — Fix

When the comment is valid and the fix is appropriate:

1. Make the change (edit the file(s)).
2. Commit with a clear message naming what was fixed.
3. Push so the PR is up-to-date.
4. Reply on the thread: what was fixed, the commit SHA, and a one-line summary of the change.
5. A push retriggers CI — return to step 0 and re-check status before declaring done.

#### Branch b — Rebut

When the comment is wrong, out of scope, or the suggested approach isn't right:

1. Do NOT change code.
2. Reply on the thread with the reasoning — why the current approach is correct, why the suggestion doesn't apply, or what context the reviewer missed. Be specific and technical, not dismissive.

### 3. Reply on the thread

Replies MUST be a reply to the original comment, not a top-level PR comment. Use the REST endpoint with `in_reply_to`:

```bash
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments \
  -f body="REPLY_BODY" \
  -F in_reply_to=ORIGINAL_COMMENT_DATABASE_ID
```

The `ORIGINAL_COMMENT_DATABASE_ID` is the `databaseId` from the GraphQL thread listing (the first comment's databaseId in that thread).

### 4. Resolve the thread

After replying (and, if you fixed, after the push completes), resolve the thread using its node ID:

```bash
gh api graphql -f query='
mutation($id:ID!){
  resolveReviewThread(input:{threadId:$id}){
    thread{ isResolved }
  }
}
' -F id=THREAD_NODE_ID
```

Resolve every thread you replied to, even rebuttals. The goal is zero unresolved threads.

### 5. Verify and report

Confirm **both** end-conditions:

1. Re-run `gh pr checks PR_NUMBER --json name,state,bucket` → every check `pass` (none `fail`, none `pending`).
2. Re-run the GraphQL thread listing → `unresolved == 0`.

Loop steps 0–4 until both hold. Then report: checks status, how many comments fixed vs rebutted, and the PR URL.

## Rules

- **Done = green checks AND zero unresolved threads.** Neither alone is sufficient.
- **Every comment gets a reply.** Never resolve without replying. Never reply without resolving (unless the thread can't be resolved — e.g. an outside-diff comment that wasn't posted as a thread; in that case post a PR-level comment documenting the disposition).
- **Replies are always in-thread** (`in_reply_to` the original comment databaseId), never top-level PR comments.
- **Fix → commit → push → reply → resolve → re-check.** Order matters: the reply should reference the commit SHA that fixed it, so the push must happen first; and every push retriggers CI, so re-check status after.
- **Rebut → reply → resolve.** No commit/push for rebuttals.
- **A failing check is a comment too.** Read its log (`gh run view --log-failed`), fix the cause, push, and re-poll. Don't resolve threads while CI is red and call it done.
- **Verify before acting.** A comment may reference code that has already changed; re-read the current file before fixing or rebutting.
- **One comment at a time** if changes could interact; batch independent ones.
- **Don't resolve threads you didn't reply to.**
- **Extraction gotcha.** Comment bodies often hide the actual recommendation inside `<details>...</details>` or behind an analysis chain. Parse out the actionable sentence (usually after the last `</details>`) before deciding fix vs rebut.
- **Never "fix" a check by re-running it** unless the log proves a transient/infra failure. A re-run that hides a real bug is a second bug.

## Determining fix vs rebut

Fix when:

- The finding is valid against the current code.
- The fix is small, correct, and doesn't contradict the repo's standards.
- The reviewer caught a real bug, security issue, or inconsistency.

Rebut when:

- The comment references old code that has since changed (the fix was already applied).
- The suggestion contradicts a documented standard or binding rule in this repo.
- The comment is a style preference the repo deliberately doesn't enforce.
- The suggested approach is technically incorrect or would introduce a worse problem.
- The comment is out of scope for this PR (note it and suggest a follow-up issue).

When unsure whether to fix or rebut, prefer fixing if the change is low-risk and improves the code; prefer rebutting if the change would require a larger architectural call that isn't yours to make unilaterally.
