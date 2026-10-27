#!/bin/sh
# Execute this file; its POSIX shebang keeps Bash and Fish callers from parsing it.
# Register this local marketplace and install every catalog plugin.
set -eu

fail() {
    printf '%s\n' "bootstrap: $*" >&2
    exit 1
}

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
CATALOG_PATH=$REPOSITORY_ROOT/.omp-plugin/marketplace.json

command -v omp >/dev/null 2>&1 || fail "omp is not on PATH; install OMP before bootstrapping"
command -v python3 >/dev/null 2>&1 || fail "python3 is required to read the marketplace catalog"

# OMP_PROFILE runs every omp call inside an isolated profile, so testing
# bootstrap never touches personal marketplace/plugin state.
omp_cmd() {
    if [ -n "${OMP_PROFILE:-}" ]; then
        omp --profile "$OMP_PROFILE" "$@"
    else
        omp "$@"
    fi
}
python3 "$REPOSITORY_ROOT/scripts/validate.py"

CATALOG_NAME=$(python3 - "$CATALOG_PATH" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["name"])
PY
)

CATALOG_PLUGINS=$(python3 - "$CATALOG_PATH" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    for plugin in json.load(handle)["plugins"]:
        print(f'{plugin["name"]}\t{plugin.get("version", "")}')
PY
)

marketplace_exists() {
    wanted=$1
    json_listing=$(omp_cmd plugin marketplace list --json 2>/dev/null || true)
    if [ -n "$json_listing" ] && printf '%s\n' "$json_listing" | python3 -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except json.JSONDecodeError:
    raise SystemExit(1)

marketplaces = payload.get("marketplaces", []) if isinstance(payload, dict) else payload
if not isinstance(marketplaces, list):
    raise SystemExit(1)
raise SystemExit(0 if any(isinstance(item, dict) and item.get("name") == sys.argv[1] for item in marketplaces) else 1)
' "$wanted"; then
        return 0
    fi

    # Current OMP releases may ignore --json for this command. In that case,
    # compare the first whitespace-delimited field exactly, never by prefix.
    listing=$(omp_cmd plugin marketplace list) || fail "could not list configured marketplaces"
    while IFS= read -r line; do
        set -- $line
        [ "${1:-}" = "$wanted" ] && return 0
    done <<EOF
$listing
EOF
    return 1
}

if marketplace_exists "$CATALOG_NAME"; then
    printf '%s\n' "bootstrap: marketplace $CATALOG_NAME is already registered"
    # OMP caches the catalog at registration time; re-read it so catalog edits
    # made after registration (new plugins, version bumps) are installable.
    omp_cmd plugin marketplace update "$CATALOG_NAME"
else
    omp_cmd plugin marketplace add "$REPOSITORY_ROOT"
fi
installed_plugins=$(omp_cmd plugin list --json) || fail "could not list installed plugins"

plugin_installed_at_version() {
    wanted=$1
    version=$2
    printf '%s\n' "$installed_plugins" | python3 -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except json.JSONDecodeError:
    raise SystemExit(1)

for item in payload.get("marketplace", []):
    if item.get("id") != sys.argv[1]:
        continue
    if any(entry.get("scope") == "user" and entry.get("version") == sys.argv[2] for entry in item.get("entries", [])):
        raise SystemExit(0)
raise SystemExit(1)
' "$wanted" "$version"
}

plugin_installed_for_user() {
    wanted=$1
    printf '%s\n' "$installed_plugins" | python3 -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except json.JSONDecodeError:
    raise SystemExit(1)

for item in payload.get("marketplace", []):
    if item.get("id") == sys.argv[1] and any(entry.get("scope") == "user" for entry in item.get("entries", [])):
        raise SystemExit(0)
raise SystemExit(1)
' "$wanted"
}

if [ -n "$CATALOG_PLUGINS" ]; then
    while IFS="$(printf '\t')" read -r plugin version; do
        [ -n "$plugin" ] || continue
        plugin_id=$plugin@$CATALOG_NAME
        if [ -n "$version" ] && plugin_installed_at_version "$plugin_id" "$version"; then
            printf '%s\n' "bootstrap: $plugin_id $version is already installed for user"
        elif plugin_installed_for_user "$plugin_id"; then
            printf '%s\n' "bootstrap: upgrading $plugin_id for user"
            omp_cmd plugin upgrade --scope user "$plugin_id"
        else
            printf '%s\n' "bootstrap: installing $plugin_id for user"
            omp_cmd plugin install --scope user "$plugin_id"
        fi
    done <<EOF
$CATALOG_PLUGINS
EOF
fi


printf '%s\n' "bootstrap: configured marketplaces"
omp_cmd plugin marketplace list
printf '%s\n' "bootstrap: installed plugins"
omp_cmd plugin list
