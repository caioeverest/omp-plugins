# Attribution

This marketplace contains first-party plugins together with skills adapted from third-party projects. Third-party copyright and license notices are preserved in place; the components below record the sources that could be verified.

## diagram-design — `plugins/tools/skills/diagram-design`

- Source: https://github.com/cathrynlavery/diagram-design
- License: MIT, © 2025 Cathryn Lavery. The bundled `LICENSE` file is retained in the skill directory.
- Bundled copy: snapshot of the upstream skill. Local modifications: none recorded.

## hallmark — `plugins/tools/skills/hallmark`

- Source: https://github.com/nutlope/hallmark (https://www.usehallmark.com)
- License: MIT, by Together AI. The `Powered by Together AI` line in the skill originates upstream and is retained.
- Bundled copy: version 1.1.0 snapshot; upstream has since released a larger v2, so this copy may lag. Local modifications: the example street address in the component templates was replaced with a fictional placeholder.

## tools plugin core — `plugins/tools`

- Parts of `usage.ts` are modeled on a third-party "fbr" base plugin named in the source comments.
- Upstream source and license: **not verified**. Unresolved — do not publish until the upstream and its redistribution terms are confirmed.

## beads skill resources — `plugins/tools/skills/beads`

- Files under `resources/` are marked "Adapted from ACF beads skill".
- The "ACF" upstream could not be identified. The beads CLI itself is https://github.com/steveyegge/beads.
- Redistribution basis for the adapted text: **not verified**. Unresolved — do not publish until confirmed.

## Bundled skills with unestablished origin — `plugins/tools/skills`

`beads`, `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `gh-stack`, `grill-with-docs`, `grilling`, `implement`, `improve-codebase-architecture`, `obsidian-vault-usage`, `pg-connect`, `pg-dev`, `pg-indexes`, `pg-locking`, `pg-queries`, `pg-transactions`, `pr-address-comments`, `pr-deep-review`, `presentation-builder`, `prototype`, `python-format`, `repo-security-review`, `research`, `resolving-merge-conflicts`, `setup-repo`, `slide-craft`, `tdd`, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `wizard`, `worktree-parallel`, `write-a-skill`, `write-an-agent`, `writing-agents`, `writing-for-agents`, `writing-great-skills`.

These are maintained in this repository. Where any of them reproduces third-party text or assets, that origin is not established here and their redistribution basis is **unresolved**.

## First-party plugins

`plugins/tools`, `plugins/persona-switcher`, and `plugins/telegram` (including their skills `persona-switcher` and `persona-generator`) are first-party to this repository. The catalog also pins the third-party Anthropic plugin `frontend-design` (`anthropics/claude-plugins-official`), which carries its own upstream license.
