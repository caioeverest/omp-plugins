---
name: presentation-builder
description: Builds PowerPoint-like HTML presentations about a subject — grills the user on goals and audience, researches supporting online content and data, then produces a self-contained slide deck (text, tables, diagrams, generated images, CSS animations) packaged as a shareable zip. Use when the user asks for a presentation, slide deck, slides, talk, pitch deck, or keynote about any subject.
---

# Presentation Builder

Produce a browser-openable HTML slide deck, fully researched, packaged as a zip.

**Required reading before building:** the `slide-craft` skill — slide design rules (one idea per slide, message-headlines, notes, visuals, animation, failure modes) live there. This skill is the workflow; that one is the craft.

## Workflow

Four phases, in order. Do not skip phase 1 — a deck built on guesses is a deck rebuilt.

### 1. Grill the user

Run the `grilling` skill (design-tree rounds via the `ask` tool — batch each round's frontier questions, 3 options + recommended). The decision tree to work:

- **Subject & core message** — what must the audience remember afterward?
- **Audience** — technical depth, prior knowledge, decision-makers or learners?
- **Purpose** — persuade, teach, report status, pitch?
- **Length & format** — target slide count, time slot, language?
- **Tone & branding** — formal/casual, colors, existing style to match?
- **Existing material** — docs, data, prior decks to incorporate?

Follow-up rounds chase whatever answers open up (e.g. "pitch" → who's the decision-maker, what's the ask). Stop when the frontier is empty and you can write the outline without guessing.

### 2. Research

- Gather supporting content: `web_search` for current facts, statistics, quotes, case studies; `read` for user-supplied materials and known URLs.
- Prefer primary sources; corroborate key claims; keep URLs of every source used (slide footer or final sources slide).
- Extract concrete data points suitable for tables and charts.
- If user data exists locally (CSVs, logs, docs), mine it — real data trumps web generalities.

### 3. Build the deck

Single self-contained `index.html` per deck unless size demands otherwise (then one file per section + shared `assets/`). Structure:

```
<presentation-slug>/
├── index.html        # the deck
├── assets/
│   ├── img/          # generated/sourced images (referenced relatively)
│   └── data/         # any data files charts render from (optional)
└── README.txt        # one-liner: open index.html, arrow keys to navigate
```

Deck requirements:

- **Navigation**: arrow keys / space / click; slide counter; optional overview grid (Esc). Vanilla JS, no build step, works from `file://`.
- **No external runtime dependencies**: inline CSS/JS or vendored files in `assets/`. A deck that needs network is a deck that fails on stage. (Exception: user explicitly OKs CDN.)
- **Slides**: `<section class="slide">` units. Craft rules (one idea, message-headlines, density, visuals) — see `slide-craft`.
- **Tables**: real `<table>`, styled.
- **Diagrams**: if a diagramming skill is installed (check available skills), use it and embed output as inline SVG. Otherwise hand-write simple inline SVG or CSS boxes/arrows. Never hotlink diagram services.
- **Images**: use the `image-generation` skill for illustrations, covers, metaphors (it calls the `aihub-image-generator` MCP and handles prompt-crafting, `trim`/`remove_bg`/`size` flags, output path). Save generated PNGs into `assets/img/` and reference relatively. For factual photos/logos, download into `assets/img/` (respect obvious licensing) — never hotlink.
- **Charts**: inline SVG or tiny vendored chart lib; render from the researched data.
- **Animations**: CSS transitions/keyframes for transitions and progressive reveals.
- **Speaker notes**: hidden `<aside class="notes">` per slide, toggled with `N` key.
- **Sources**: final slide (or footers) listing every source URL used.

### 4. Package

```bash
cd <parent-of-presentation-slug> && zip -r <presentation-slug>.zip <presentation-slug>
```

Verify zip contents (`unzip -l`) include all assets. Deliver the folder path AND the zip path.

## Quality checklist

Before delivering:

- [ ] Opens from `file://` with no network and no console errors
- [ ] All images/diagrams load (relative paths, present in zip)
- [ ] Slide count matches what user approved
- [ ] Every factual claim traceable to a source
- [ ] Failure modes in `slide-craft` checked: no topic-outline headlines, no document-in-slides, no orphan deck
- [ ] Zip verified with `unzip -l`

## Pitfalls

- Don't start building before the grilling phase closes — scope drift is the #1 failure.
- Don't hotlink anything. Vendored or generated, always local.
