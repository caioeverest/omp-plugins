# HTML Report Format

The report is one **self-contained** HTML file in the OS temp directory: inline `<style>`, no CDN, opens offline. Diagrams are hand-built HTML/CSS/inline SVG. When a diagram is genuinely graph- or sequence-shaped and the network is available, a Mermaid block reads best; otherwise draw it by hand — don't lean on Mermaid for everything, or every report starts to look generic.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review — {{repo name}}</title>
    <style>
      :root { --ink:#0f172a; --line:#e2e8f0; --leak:#dc2626; --warn:#b45309; --ok:#047857; }
      body { margin:0; background:#fafaf9; color:var(--ink); font:15px/1.55 ui-sans-serif,system-ui,sans-serif; }
      main { max-width:64rem; margin:0 auto; padding:3rem 1.5rem; display:flex; flex-direction:column; gap:3rem; }
      .card { border:1px solid var(--line); border-radius:.5rem; background:#fff; padding:1.25rem; }
      .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
      .mono { font-family:ui-monospace,SFMono-Regular,monospace; font-size:.8rem; }
      .label { font-size:.7rem; text-transform:uppercase; letter-spacing:.1em; color:#64748b; }
      .badge { display:inline-block; border-radius:9999px; padding:.1rem .6rem; font-size:.75rem; }
      .badge.strong { background:#d1fae5; color:var(--ok); }
      .badge.worth { background:#fef3c7; color:var(--warn); }
      .badge.spec { background:#e2e8f0; color:#475569; }
      .seam { stroke-dasharray:4 4; }
      .leak { stroke:var(--leak); }
      .deep { background:linear-gradient(135deg,#0f172a,#1e293b); color:#f8fafc; }
    </style>
  </head>
  <body>
    <main>
      <header>…</header>
      <section id="candidates" style="display:flex;flex-direction:column;gap:2.5rem">…</section>
      <section id="top-recommendation">…</section>
    </main>
  </body>
</html>
```

Add the Mermaid ESM import only inside a `<script type="module">` when you actually use a Mermaid diagram (the one optional network fetch). Everything else stays static.

## Header

Repo name, date, and a compact legend: solid box = module, dashed line = seam, red arrow = leakage, thick dark box = deep module. No introduction paragraph — straight into the candidates.

## Candidate card

The diagrams carry the weight. Each candidate is one `<article class="card">`:

- **Title** — short, names the deepening (e.g. "Collapse the Order intake pipeline").
- **Badge row** — recommendation strength (`strong` / `worth` / `spec`) plus the dependency category (`in-process`, `local-substitutable`, `ports & adapters`, `mock`).
- **Files** — monospaced list (`.mono`).
- **Before / After diagram** — the centrepiece, two columns (`.grid-2`).
- **Problem** — one sentence. What hurts.
- **Solution** — one sentence. What changes.
- **Wins** — bullets, ≤6 words each (e.g. "Tests hit one interface", "Delete 4 shallow wrappers").
- **ADR callout** — one amber-tinted line, when applicable.

No paragraphs of explanation. If a diagram needs a paragraph to be understood, redraw the diagram.

## Diagram patterns

Pick the pattern that fits the candidate, and mix them — variety is part of the point.

- **Boxes-and-arrows** (inline SVG over a relative container) — the workhorse for "X calls Y calls Z, and look at the mess", and for the "after" box as one thick-bordered deep module with greyed-out internals.
- **Mermaid `flowchart`/`graph`** — when the structure is graph- or sequence-shaped; wrap it in a `.card` so it doesn't feel parachuted in. Style leakage edges red and the deep module dark via `classDef`.
- **Cross-section** — stacked horizontal bands (`h-12 border-l-4`) for layered shallowness: before, 6 thin layers each doing nothing; after, 1 thick band with the consolidated responsibility.
- **Mass diagram** — two rectangles per module, one for interface surface, one for implementation: before, interface nearly as tall as implementation (shallow); after, interface short, implementation tall (deep).
- **Call-graph collapse** — before, a tree of calls as nested boxes; after, the same tree in one box with the now-internal calls faded inside it.

## Style

Lean editorial, not corporate-dashboard: generous whitespace, optional `font-serif` headings on stone/slate. Colour sparingly — one accent (emerald or indigo), red for leakage, amber for warnings. Keep diagrams ~320px tall so before/after sits side by side without scrolling. Module labels inside diagrams use `.label` — schematic, not UI. The only script is the optional Mermaid import; the report is otherwise static.

## Tone

Plain English, concise — the architectural nouns and verbs come straight from the `/codebase-design` skill, which is their single source (including which substitutes to avoid). Concision is not an excuse to drift.

Phrasings that fit the style:

- "Order intake module is shallow — interface nearly matches the implementation."
- "Pricing leaks across the seam."
- "Deepen: one interface, one place to test."
- "Two adapters justify the seam: HTTP in prod, in-memory in tests."

**Wins bullets** name the gain in glossary terms: *"locality: bugs concentrate in one module"*, *"leverage: one interface, N call sites"*, *"interface shrinks; implementation absorbs the wrappers"*. Don't write *"easier to maintain"* or *"cleaner code"* — those terms don't earn their place.

No hedging, no throat-clearing, no "it's worth noting that…". If a sentence could be a bullet, make it a bullet. If a bullet could be cut, cut it. If a term isn't in the `/codebase-design` glossary, reach for one that is before inventing a new one.
