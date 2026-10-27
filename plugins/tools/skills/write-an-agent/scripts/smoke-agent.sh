#!/usr/bin/env bash
# smoke-agent.sh — static smoke check for an omp agent definition file.
#
# Usage: smoke-agent.sh <path-to-agent.md> [agent-name]
#
# Static checks only: frontmatter parses, required fields exist, the name is
# unique across project/user/plugin agent dirs (or the shadow is reported),
# and the body is non-empty. It cannot exercise dispatch — after this passes,
# spawn the agent on a real task to verify end-to-end behaviour.
set -euo pipefail

file="${1:?usage: smoke-agent.sh <agent.md> [agent-name]}"
want_name="${2:-}"

fail=0
err() { echo "FAIL: $*" >&2; fail=1; }
ok()  { echo "ok: $*"; }

# --- frontmatter extraction -------------------------------------------------
# Frontmatter is the first --- ... --- block.
frontmatter=$(awk 'NR==1 && $0=="---" {fm=1; next} fm && $0=="---" {exit} fm {print}' "$file")
[ -n "$frontmatter" ] || { err "no YAML frontmatter block found in $file"; echo; exit 1; }

get_field() { printf '%s\n' "$frontmatter" | sed -n "s/^$1:[[:space:]]*//p" | head -1 | sed 's/^["'"'"']//; s/["'"'"']$//'; }

name=$(get_field name)
desc=$(get_field description)

[ -n "$name" ] || err "frontmatter missing required field: name"
[ -n "$desc" ] || err "frontmatter missing required field: description"
[ -n "$name" ] && ok "name: $name"
[ -n "$desc" ] && ok "description present (${#desc} chars)"

if [ -n "$want_name" ] && [ "$name" != "$want_name" ]; then
  err "frontmatter name '$name' != expected '$want_name'"
fi

# --- body -------------------------------------------------------------------
body=$(awk 'NR==1 && $0=="---" {fm=1; next} fm && $0=="---" {fm=0; body=1; next} body {print}' "$file")
[ -n "$(printf '%s' "$body" | tr -d '[:space:]')" ] || err "agent body (system prompt) is empty"
[ -n "$(printf '%s' "$body" | tr -d '[:space:]')" ] && ok "body non-empty ($(printf '%s' "$body" | wc -l | tr -d ' ') lines)"

# --- name collision scan ----------------------------------------------------
# Discovery precedence: project .omp/agents -> user ~/.omp/agent/agents ->
# extension/plugin agents dirs -> bundled. First-wins by exact name.
[ -n "$name" ] || { echo; exit 1; }

scan_dir() {
  local dir="$1" label="$2"
  [ -d "$dir" ] || return 0
  local f other
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    [ "$f" = "$file" ] && continue
    other=$(printf '%s\n' "$(awk 'NR==1 && $0=="---" {fm=1; next} fm && $0=="---" {exit} fm {print}' "$f")" | get_field name)
    if [ "$other" = "$name" ]; then
      echo "WARN: name '$name' also defined in $label: $f (first-wins by discovery order)"
    fi
  done
}

case "$file" in
  "$HOME"/.omp/agent/agents/*)
    scan_dir ".omp/agents" "project agents (would SHADOW this user agent)" ;;
  */.omp/agents/*)
    scan_dir "$HOME/.omp/agent/agents" "user agents (this project agent SHADOWS them)" ;;
  *)
    # Draft location unknown: report any same-named file already discovered.
    scan_dir ".omp/agents" "project agents"
    scan_dir "$HOME/.omp/agent/agents" "user agents" ;;
esac
# Bundled agents that a custom file would shadow:
for b in scout designer reviewer security-reviewer librarian task sonic; do
  if [ "$name" = "$b" ]; then
    echo "WARN: name '$name' shadows a bundled agent — confirm this is a deliberate override"
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS: $file"
  echo "Next: dispatch it once — task with agent: \"$name\" and a task drawn from the description's trigger list."
else
  echo "FAIL: $file" >&2
  exit 1
fi
