#!/bin/sh
# Manage OMP personality files without replacing an unmanaged personality.
set -eu

AGENT_DIR=${OMP_PERSONA_AGENT_DIR:-"$HOME/.omp/agent"}
LIBRARY=$AGENT_DIR/personas
SLOT=$AGENT_DIR/PERSONALITY.md
BACKUP=$AGENT_DIR/PERSONALITY.md.persona-switcher-backup

fail() {
    printf '%s\n' "persona: $*" >&2
    exit 1
}

is_slug() {
    slug=$1
    [ -n "$slug" ] && [ "${#slug}" -le 64 ] || return 1
    case $slug in
        -*|*-|*[!a-z0-9-]*) return 1 ;;
    esac
}

active_name() {
    [ -f "$SLOT" ] || {
        printf '%s\n' none
        return
    }
    IFS= read -r first_line < "$SLOT" || true
    case $first_line in
        '<!-- omp-persona: '*' -->')
            name=${first_line#'<!-- omp-persona: '}
            name=${name%' -->'}
            if is_slug "$name"; then
                printf '%s\n' "$name"
                return
            fi
            ;;
    esac
    printf '%s\n' none
}

usage() {
    cat <<'EOF'
Usage: persona.sh <command> [arguments]

Commands:
  list                    List saved personas and the active one
  current                 Print active persona, or none
  use <slug>              Activate a saved persona
  off                     Deactivate and restore any backed-up personality
  show <slug>             Print a saved persona
  remove <slug> --confirm Delete an inactive saved persona
EOF
}

list_personas() {
    active=$(active_name)
    printf 'Active: %s\n\nLibrary (%s):\n' "$active" "$LIBRARY"
    found=false
    for file in "$LIBRARY"/*.md; do
        [ -e "$file" ] || continue
        name=${file##*/}
        name=${name%.md}
        if [ "$name" = "$active" ]; then
            printf '  * %s\n' "$name"
        else
            printf '    %s\n' "$name"
        fi
        found=true
    done
    [ "$found" = true ] || printf '  (empty)\n'
}

activate() {
    slug=${1:-}
    is_slug "$slug" || fail "slug must use lowercase letters, digits, and interior hyphens"
    persona=$LIBRARY/$slug.md
    [ -f "$persona" ] || fail "persona not found: $slug"

    current=$(active_name)
    if [ -e "$SLOT" ] && [ "$current" = none ]; then
        [ ! -e "$BACKUP" ] || fail "backup already exists: $BACKUP; restore or remove it first"
        cp "$SLOT" "$BACKUP"
    fi

    tmp=$SLOT.tmp.$$
    {
        printf '<!-- omp-persona: %s -->\n' "$slug"
        cat "$persona"
    } > "$tmp"
    mv "$tmp" "$SLOT"
    printf 'Activated %s. Start a new OMP session for it to take effect.\n' "$slug"
}

deactivate() {
    current=$(active_name)
    [ "$current" != none ] || fail "no persona-switcher persona is active"
    rm "$SLOT"
    if [ -e "$BACKUP" ]; then
        mv "$BACKUP" "$SLOT"
        printf 'Deactivated %s and restored the prior personality file.\n' "$current"
    else
        printf 'Deactivated %s.\n' "$current"
    fi
}

show_persona() {
    slug=${1:-}
    is_slug "$slug" || fail "invalid slug"
    cat "$LIBRARY/$slug.md"
}

remove_persona() {
    slug=${1:-}
    confirmation=${2:-}
    is_slug "$slug" || fail "invalid slug"
    [ "$confirmation" = --confirm ] || fail "removal requires --confirm"
    [ "$(active_name)" != "$slug" ] || fail "deactivate $slug before removing it"
    [ -f "$LIBRARY/$slug.md" ] || fail "persona not found: $slug"
    rm "$LIBRARY/$slug.md"
    printf 'Removed %s.\n' "$slug"
}

mkdir -p "$LIBRARY"
command=${1:-}
shift || true
case $command in
    list) list_personas ;;
    current) active_name ;;
    use) activate "${1:-}" ;;
    off) deactivate ;;
    show) show_persona "${1:-}" ;;
    remove) remove_persona "${1:-}" "${2:-}" ;;
    *) usage; exit 1 ;;
esac
