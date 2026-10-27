---
name: obsidian-vault-usage
description: Search, create, and manage notes in an Obsidian vault with wikilinks and index notes. Use when reading or writing Obsidian notes, when a task mentions the vault, or when another skill references vault conventions.
---

# Obsidian Vault Usage

## CRITICAL: use the obsidian MCP, never the filesystem

All vault reads, writes, and searches MUST go through the `obsidian` MCP server (tools prefixed `mcp__obsidian_` when user-installed, or `mcp__base_obsidian_` if plugin-shipped). NEVER read, write, edit, or move vault files directly on the filesystem, and NEVER search the vault with `grep`/`find`/Glob on the vault directory — the MCP's search is the only correct index. Filesystem writes race Obsidian's own cache and can corrupt notes.

If the obsidian MCP is not connected, say so and stop; do not fall back to filesystem access.

## Vault location

The referencing skill or task states the vault root (e.g. `~/obsidian/work/Shared/`). Mostly flat at root level.

## Naming conventions

- **Index notes**: aggregate related topics (e.g., `Ralph Wiggum Index.md`, `Skills Index.md`, `RAG Index.md`)
- **Title case** for all note names
- No folders for organization - use links and index notes instead

## Linking

- Use Obsidian `[[wikilinks]]` syntax: `[[Note Title]]`
- Notes link to dependencies/related notes at the bottom
- Index notes are just lists of `[[wikilinks]]`

## Workflows

All workflows below run through obsidian MCP tools. Use the server's search tools for every lookup — by title or by content.

### Search for notes

Use the MCP search tools (simple search by title/content, or the JSON-logic query tool for compound queries). Rank and open the best match before answering; never answer from a filename alone — read the note via the MCP.

### Create a new note

1. Use **Title Case** for the note name
2. Write content as a unit of learning (per vault rules)
3. Add `[[wikilinks]]` to related notes at the bottom
4. If part of a numbered sequence, use the hierarchical numbering scheme
5. Create or update the note via the MCP's write tools

### Find related notes

Search the vault for `[[Note Title]]` via the MCP search to find backlinks.

### Find index notes

Search the vault for `Index` via the MCP search.
