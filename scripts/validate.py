#!/usr/bin/env python3
"""Validate the local OMP marketplace layout without third-party dependencies."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = REPOSITORY_ROOT / ".omp-plugin" / "marketplace.json"
NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")
GIT_SHA_PATTERN = re.compile(r"^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$")
FIELD_PATTERN = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$")


class Validation:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.skill_names: dict[str, Path] = {}
        self.skill_count = 0

    def error(self, path: Path | str, message: str) -> None:
        try:
            display_path = Path(path).resolve().relative_to(REPOSITORY_ROOT)
        except ValueError:
            display_path = Path(path)
        self.errors.append(f"{display_path}: {message}")


def load_json(path: Path, validation: Validation) -> Any | None:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        validation.error(path, "missing required file")
    except json.JSONDecodeError as error:
        validation.error(path, f"invalid JSON: {error.msg} (line {error.lineno}, column {error.colno})")
    return None


def is_name(value: Any) -> bool:
    return isinstance(value, str) and bool(NAME_PATTERN.fullmatch(value))


def require_nonempty_string(value: Any, path: Path, field: str, validation: Validation) -> bool:
    if not isinstance(value, str) or not value.strip():
        validation.error(path, f"{field} must be a nonempty string")
        return False
    return True


def require_name(value: Any, path: Path, field: str, validation: Validation) -> bool:
    if not is_name(value):
        validation.error(path, f"{field} must match {NAME_PATTERN.pattern}")
        return False
    return True


def is_contained(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def validate_catalog(validation: Validation) -> tuple[dict[str, Any] | None, Path | None]:
    catalog = load_json(CATALOG_PATH, validation)
    if not isinstance(catalog, dict):
        if catalog is not None:
            validation.error(CATALOG_PATH, "catalog must be a JSON object")
        return None, None

    require_name(catalog.get("name"), CATALOG_PATH, "name", validation)

    owner = catalog.get("owner")
    if not isinstance(owner, dict):
        validation.error(CATALOG_PATH, "owner must be an object with name")
    else:
        require_nonempty_string(owner.get("name"), CATALOG_PATH, "owner.name", validation)

    metadata = catalog.get("metadata")
    plugin_root: Path | None = None
    if not isinstance(metadata, dict):
        validation.error(CATALOG_PATH, "metadata must be an object")
    else:
        require_nonempty_string(metadata.get("description"), CATALOG_PATH, "metadata.description", validation)
        require_nonempty_string(metadata.get("version"), CATALOG_PATH, "metadata.version", validation)
        plugin_root_value = metadata.get("pluginRoot")
        if plugin_root_value != "./plugins":
            validation.error(CATALOG_PATH, 'metadata.pluginRoot must be "./plugins"')
        else:
            plugin_root = (REPOSITORY_ROOT / plugin_root_value).resolve()
            if not is_contained(plugin_root, REPOSITORY_ROOT.resolve()):
                validation.error(CATALOG_PATH, "metadata.pluginRoot must resolve inside the repository")

    plugins = catalog.get("plugins")
    if not isinstance(plugins, list):
        validation.error(CATALOG_PATH, "plugins must be an array")
        return catalog, plugin_root

    plugin_names: set[str] = set()
    for index, plugin in enumerate(plugins):
        location = f"plugins[{index}]"
        if not isinstance(plugin, dict):
            validation.error(CATALOG_PATH, f"{location} must be an object")
            continue

        name = plugin.get("name")
        if require_name(name, CATALOG_PATH, f"{location}.name", validation):
            if name in plugin_names:
                validation.error(CATALOG_PATH, f"duplicate plugin name: {name}")
            plugin_names.add(name)
        require_nonempty_string(plugin.get("description"), CATALOG_PATH, f"{location}.description", validation)
        require_nonempty_string(plugin.get("version"), CATALOG_PATH, f"{location}.version", validation)

        source = plugin.get("source")
        if isinstance(source, str):
            if not source.startswith("./") or source == "./":
                validation.error(CATALOG_PATH, f"{location}.source must be a nonempty ./<plugin-name> path")
                continue
            if plugin_root is None:
                continue

            resolved_source = (plugin_root / source).resolve()
            if not is_contained(resolved_source, REPOSITORY_ROOT.resolve()):
                validation.error(CATALOG_PATH, f"{location}.source resolves outside the repository")
            elif not is_contained(resolved_source, plugin_root):
                validation.error(CATALOG_PATH, f"{location}.source resolves outside metadata.pluginRoot")
            elif not resolved_source.is_dir():
                validation.error(CATALOG_PATH, f"{location}.source does not resolve to a directory")
        elif isinstance(source, dict):
            if set(source) != {"source", "url", "path", "ref", "sha"}:
                validation.error(CATALOG_PATH, f"{location}.source must contain only source, url, path, ref, and sha")
                continue
            if source.get("source") != "git-subdir":
                validation.error(CATALOG_PATH, f"{location}.source.source must be git-subdir")
            require_nonempty_string(source.get("url"), CATALOG_PATH, f"{location}.source.url", validation)
            path = source.get("path")
            if not isinstance(path, str) or not path or path.startswith("/") or ".." in Path(path).parts:
                validation.error(CATALOG_PATH, f"{location}.source.path must be a nonempty relative path")
            require_nonempty_string(source.get("ref"), CATALOG_PATH, f"{location}.source.ref", validation)
            sha = source.get("sha")
            if not isinstance(sha, str) or not GIT_SHA_PATTERN.fullmatch(sha):
                validation.error(CATALOG_PATH, f"{location}.source.sha must be a full 40- or 64-character Git SHA")
        else:
            validation.error(CATALOG_PATH, f"{location}.source must be a local path or pinned git-subdir source")

    return catalog, plugin_root




def yaml_scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1].strip()
    if " #" in value:
        value = value.split(" #", 1)[0].rstrip()
    return value


def skill_frontmatter(path: Path, validation: Validation) -> dict[str, str] | None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        validation.error(path, "SKILL.md must be UTF-8")
        return None
    if not lines or lines[0] != "---":
        validation.error(path, "SKILL.md must begin with YAML frontmatter delimited by ---")
        return None

    try:
        end = lines.index("---", 1)
    except ValueError:
        validation.error(path, "YAML frontmatter is missing its closing --- delimiter")
        return None

    values: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#") or line[0].isspace():
            continue
        match = FIELD_PATTERN.fullmatch(line)
        if match is None:
            validation.error(path, "frontmatter must use YAML key: value entries")
            return None
        key, raw_value = match.groups()
        values[key] = yaml_scalar(raw_value or "")
    return values


def validate_skill(path: Path, effective_default: str, validation: Validation) -> None:
    values = skill_frontmatter(path, validation)
    if values is None:
        return
    description = values.get("description", "")
    if not description:
        validation.error(path, "frontmatter description must be nonempty")
        return
    name = values.get("name", effective_default)
    if not name:
        validation.error(path, "frontmatter name must be nonempty when present")
        return
    if name in validation.skill_names:
        validation.error(path, f"duplicate effective skill name {name!r}; already defined by {validation.skill_names[name].relative_to(REPOSITORY_ROOT)}")
        return
    validation.skill_names[name] = path
    validation.skill_count += 1


def validate_skills(plugin_root: Path | None, validation: Validation) -> None:
    standalone_root = REPOSITORY_ROOT / "skills"
    if standalone_root.exists():
        for skill_file in standalone_root.rglob("SKILL.md"):
            relative = skill_file.relative_to(standalone_root)
            if len(relative.parts) != 2 or relative.name != "SKILL.md":
                validation.error(skill_file, "standalone skills must be skills/<skill-name>/SKILL.md")
                continue
            validate_skill(skill_file, relative.parent.name, validation)

    if plugin_root is None or not plugin_root.exists():
        return
    for skills_root in plugin_root.glob("*/skills"):
        if not skills_root.is_dir():
            continue
        for skill_file in skills_root.rglob("SKILL.md"):
            relative = skill_file.relative_to(skills_root)
            if len(relative.parts) != 2 or relative.name != "SKILL.md":
                validation.error(skill_file, "bundled skills must be plugins/<plugin-name>/skills/<skill-name>/SKILL.md")
                continue
            validate_skill(skill_file, relative.parent.name, validation)


def main() -> int:
    validation = Validation()
    catalog, plugin_root = validate_catalog(validation)
    validate_skills(plugin_root, validation)

    if validation.errors:
        print("Marketplace validation failed:", file=sys.stderr)
        for error in validation.errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    plugin_count = len(catalog["plugins"]) if catalog is not None else 0
    catalog_name = catalog["name"] if catalog is not None else "unknown"
    print(f"Marketplace validation passed: {catalog_name} ({plugin_count} plugins), {validation.skill_count} skills.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
