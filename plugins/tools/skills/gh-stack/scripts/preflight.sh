#!/usr/bin/env bash
# Read-only gh-stack environment and active-stack check.
set -u

failures=0
warnings=0

ok() { printf 'OK   %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL %s\n' "$*"; failures=$((failures + 1)); }

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail 'Not inside Git repository.'
  exit 1
fi
ok "Repository: $(git rev-parse --show-toplevel)"

if [[ -n $(git status --porcelain) ]]; then
  fail 'Working tree dirty. Commit, stash, or discard changes before stack operations.'
else
  ok 'Working tree clean.'
fi

if ! command -v gh >/dev/null 2>&1; then
  fail '`gh` not found in PATH.'
else
  ok "$(gh --version | head -n1)"
fi

if ! gh extension list 2>/dev/null | awk '$1 == "gh-stack" { found=1 } END { exit !found }'; then
  fail '`gh-stack` extension missing. Install: gh extension install github/gh-stack'
elif ! gh stack --help >/dev/null 2>&1; then
  fail '`gh stack` unavailable or unhealthy.'
else
  ok '`gh stack` available.'
fi

if ! gh auth status >/dev/null 2>&1; then
  fail '`gh` not authenticated. Run: gh auth login'
else
  ok '`gh` authenticated.'
fi

if ! remote_url=$(git remote get-url origin 2>/dev/null); then
  fail '`origin` remote missing.'
else
  ok "origin: $remote_url"
fi

if trunk=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null) && [[ -n $trunk ]]; then
  ok "Default branch: $trunk"
else
  warn 'Could not determine default branch through GitHub API.'
fi

if stack=$(GH_PAGER=cat gh stack view --short 2>&1); then
  printf 'OK   Active stack:\n%s\n' "$stack"
else
  warn "No active stack or unable to inspect it: $stack"
fi

if ((failures > 0)); then
  printf '\nPreflight failed: %d failure(s), %d warning(s).\n' "$failures" "$warnings"
  exit 1
fi

printf '\nPreflight passed: %d warning(s). No changes made.\n' "$warnings"
