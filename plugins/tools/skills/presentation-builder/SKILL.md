---
name: presentation-builder
description: Build or edit HTML presentations and talk materials. Builds a self-contained slide deck about a subject (text, tables, diagrams, images, CSS animations) after grilling the user on goals/audience and researching supporting content. Edits existing decks and slides directly, without re-running the build workflow. Use when the user asks for a presentation, slide deck, slides, talk, pitch deck, or keynote — or to edit, reorder, restyle, or fix existing slide content.
---

# Presentation Builder

Two routes, one craft. Pick the route from the ask, then apply the craft rules to every slide either produces.

- **Build** — a new deck about a subject: the workflow below (settle open decisions → research → build → package).
- **Edit** — change, reorder, restyle, fix, or extend slides the user already has: work on that artifact directly, no grilling, online research, or zip.

## Craft rules (both routes)

A slide is not a document page. It is read at distance, in seconds, while a voice competes for attention. Every rule follows from that.

- **One idea per slide.** Slide count is free; attention is not. Two ideas means the audience picks one and the speaker narrates the other — one is lost. Split.
- **Headline carries the message.** A headline states the slide's conclusion ("Caching cut p99 latency 4×"), never its topic ("Performance"). The audience should follow the talk reading headlines alone.
- **Words are for what visuals can't say.** Sentences get read instead of listened to; the slide competes with the speaker and both lose. Fragments, labels, numbers — the sentence version lives in the speaker notes.
- **Speaker notes carry the narrative.** The slide is evidence; the notes are the argument. Notes are what make a deck deliverable by someone other than its author.
- **Readable at distance decides type and density.** Base type ≥24px equivalent, high contrast, generous whitespace. If a slide needs small type to fit, it is two slides.
- **Numbers beat adjectives.** "Fast" is noise; "p99 240ms → 58ms" is content. Every claim that can carry a number should.
- **Progressive disclosure within a slide** (bullet-by-bullet reveals) keeps eyes where the voice is — use it for sequences that build, skip it for single statements.

**Structure.**

- **Arc**: stakes → evidence → ask. Open with why the audience should care (problem, number, risk), build the case, close with the decision or action wanted. Teaching decks: question → build-up → answer.
- **Signposting**: section dividers for decks over ~15 slides; the audience cannot scroll back.
- **Appendix** absorbs what the narrative needs to *exist* but not to *tell*: detailed data, methodology, backup numbers. Distill on the main path; depth behind it.

**Visuals.**

- **A visual must earn its slide.** Diagram for structure, chart for trend or comparison, table for exact lookup values, image for emotional or concrete grounding. Decoration is weight.
- **Chart choice**: line for time, bar for comparison, scatter for correlation. Pie only for parts-of-whole with ≤5 slices. Label axes and units; source the chart on itself.
- **Tables**: exact values only; round aggressively; highlight the row or column the audience should look at. Past ~6×6 cells it is data, not a slide — chart it or appendix it.
- **Diagrams**: fewest boxes that carry the structure; arrows mean one thing per diagram (data flow, dependency, sequence — pick one); labels on arrows, not just boxes.
- **Consistency reads as credibility**: one palette, one type scale, one icon style. Mixed visual languages read as assembled, not authored.

**Animation** is emphasis, not entertainment — direct attention (reveal the next point, highlight the changed bar) and nowhere else. Transitions ≤300ms; honor `prefers-reduced-motion`. An animation the audience notices as animation has failed.

**Audience calibration** — depth, jargon, and pacing are set by the audience, not the subject:

- **Decision-makers**: conclusion first, evidence compressible to appendix, the ask explicit.
- **Technical peers**: mechanism over motivation; show the how, skip the why-we-care.
- **Mixed rooms**: layer it — headline for everyone, visual for the non-specialist, detail in notes and appendix for the specialist.

Calibrate vocabulary, not rigor: simplify words, never falsify content.

**Sources.** Every factual claim traceable — per-slide footers or a final sources slide. An unsourced number in a persuasive deck is a liability.

**Failure modes** — check against each before delivering:

- **Topic-outline deck**: headlines name topics, not messages; no arc.
- **Document-in-slides**: paragraphs pasted onto slides; read, not presented.
- **Wall-of-data table**: raw dumps where a chart or single number belongs.
- **Animation-as-filler**: motion with no attention-directing job.
- **Orphan deck**: no notes, no sources — undeliverable by anyone but its author.

## Route: edit existing slides

Edit the file(s) the user named — a section, a slide, a whole deck. This is a change to an existing artifact, not a rebuild.

- **Preserve** what you are not asked to change: navigation, slide order, layout system, palette, type scale, and existing speaker notes and sources. Match the deck's existing conventions rather than importing a new one.
- **Do not** grill, research online, re-run the outline, or zip the deck unless asked. Apply the craft rules to the change and stop.
- Add notes, sources, or accessibility wiring only when the change needs them or the user asks (a new claim gets a source; a new slide gets notes), following the deck's existing convention.
- Keep decks openable the way they already open — a self-contained deck stays self-contained; don't silently vendor or unvendor a CDN the user chose.

## Route: build a new deck

Four phases. Do not skip phase 1 when a decision is open — a deck built on guesses is a deck rebuilt.

### 1. Settle the open decisions

Resolve only the material decisions the brief hasn't already answered. Treat everything the user supplied (prompt, attached docs, surrounding repo, prior decks) as settled and do not re-ask it. The topics to have settled before building:

- **Subject & core message** — what must the audience remember afterward?
- **Audience** — technical depth, prior knowledge, decision-makers or learners?
- **Purpose** — persuade, teach, report status, pitch?
- **Length & format** — target slide count, time slot, language?
- **Tone & branding** — formal/casual, colors, existing style to match?
- **Existing material** — docs, data, prior decks to incorporate?

**A complete brief that answers all six skips this phase entirely** — go straight to phase 2, no questioning round. When some are open, run the `grilling` skill on just that open frontier (design-tree rounds), chase whatever the answers open up (e.g. "pitch" → who's the decision-maker, what's the ask), and stop when nothing material is left to guess.

### 2. Research

- Gather supporting content: `web_search` for current facts, statistics, quotes, case studies; `read` for user-supplied materials and known URLs.
- Prefer primary sources; corroborate key claims; keep the URL of every source used.
- Extract concrete data points suitable for tables and charts.
- If user data exists locally (CSVs, logs, docs), mine it — real data trumps web generalities.

Skip this phase when the user supplies the content or asks for a deck built only from their material.

### 3. Build the deck

One self-contained `index.html` per deck unless size demands otherwise (then one file per section + shared `assets/`). Structure:

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
- **Offline by default**: inline CSS/JS and vendored assets so the deck opens from `file://` with no network. A deck that needs the network is a deck that fails on stage. Link a CDN only when the user explicitly opts into network use.
- **Slides**: `<section class="slide">` units. Apply the craft rules above.
- **Tables**: real `<table>`, styled.
- **Diagrams**: if the `diagram-design` skill is installed (check available skills), use it and embed output as inline SVG. Otherwise hand-write simple inline SVG or CSS boxes/arrows. Never hotlink diagram services.
- **Images**: if an image-generation skill or MCP is installed (check available skills/tools), use it for illustrations, covers, and metaphors, and save the generated PNGs into `assets/img/`. Otherwise hand-build real SVG/CSS art or ask the user for assets — **never ship invented stock/placeholder imagery as if it were the final design**. For factual photos/logos, download into `assets/img/` (respect obvious licensing) — never hotlink.
- **Charts**: inline SVG or a tiny vendored chart lib; render from the researched data.
- **Speaker notes**: hidden `<aside class="notes">` per slide, toggled with `N` — add these when the deck is meant to be delivered by someone other than its author, or the user asks.
- **Sources**: final slide (or per-slide footers) listing every source URL used, when the deck carries sourced claims.
- **Accessibility**: semantic sections, alt text on images, a readable heading per slide.

### 4. Package

Build the zip only when the user wants a shareable file:

```bash
cd <parent-of-presentation-slug> && zip -r <presentation-slug>.zip <presentation-slug>
```

Verify zip contents (`unzip -l`) include all assets. Deliver the folder path AND the zip path.

## Quality checklist

Before delivering:

- [ ] The route matched the ask (new build vs. edit) — no grilling/research/zip on an edit
- [ ] Opens from `file://` with no network (or the CDN choice the user made) and no console errors
- [ ] All images/diagrams load (relative paths, present in zip if zipped)
- [ ] Slide count matches what the user approved
- [ ] Every factual claim traceable to a source
- [ ] Failure modes above checked: no topic-outline headlines, no document-in-slides, no orphan deck
- [ ] If zipped, the zip verified with `unzip -l`

## Pitfalls

- Don't start building a new deck before the grilling phase closes — scope drift is the #1 failure. Don't run it on an edit.
- Don't hotlink anything. Vendored or generated, always local.
