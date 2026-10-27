---
name: slide-craft
description: Reference for designing presentation slides for a human audience — one idea per slide, message-headlines, structure, visuals, animation, and delivery mechanics for HTML decks. Use when creating or editing presentation content, slides, decks, or talk materials. Required reading for presentation-builder.
---

Reference for any presentation an agent builds for humans — the slide-craft rules, not the workflow of a particular builder. Packaging differs (HTML deck, PDF export, slides-as-markdown); the craft does not.

## The medium

A slide is not a document page. It is read at distance, in seconds, while a voice competes for attention. Every rule below follows from that.

- **One idea per slide.** Slide count is free; attention is not. Two ideas on one slide means the audience picks one and the speaker narrates the other — one of them is lost. Split.
- **Headline carries the message.** A slide headline states the slide's conclusion ("Caching cut p99 latency 4×"), never its topic ("Performance"). The audience should follow the talk reading headlines alone. Topic-headlines are the topic-outline failure mode: a deck whose headlines could be shuffled without loss says nothing.
- **Words are for what visuals can't say.** Full sentences on a slide are read instead of listening — the slide competes with the speaker and both lose. Fragments, labels, numbers. The sentence version lives in speaker notes.
- **Speaker notes carry the narrative.** The slide is evidence; the notes are the argument. A deck without notes can only be delivered by its author — notes are what make it transferable.

## Density and type

- **Readable at distance** decides everything: base type ≥24px equivalent, high contrast, generous whitespace. If a slide needs small type to fit, it needs to be two slides.
- **Numbers beat adjectives.** "Fast" is noise; "p99 240ms → 58ms" is content. Every claim that can carry a number should.
- **Progressive disclosure within a slide** (bullet-by-bullet reveals) exists to keep eyes where the voice is. Use it for sequences that build; skip it for single statements.

## Structure

- **Arc**: stakes → evidence → ask. Open with why the audience should care (the problem, the number, the risk), build the case, close with the decision or action wanted. Teaching decks: question → build-up → answer.
- **Signposting**: section dividers for decks over ~15 slides; the audience cannot scroll back.
- **Appendix** absorbs everything the narrative needs to *exist* but not to *tell*: detailed data, methodology, backup numbers. Distill on the main path; depth behind it.
- **Sources**: every factual claim traceable — footers per slide or a final sources slide. An unsourced number in a persuasive deck is a liability.

## Visuals

- **A visual must earn its slide.** Diagram for structure, chart for trend or comparison, table for exact lookup values, image for emotional or concrete grounding. Decoration is weight.
- **Chart choice**: line for time, bar for comparison, scatter for correlation. Pie only for parts-of-whole with ≤5 slices. Label axes and units; note the source on the chart itself.
- **Tables**: exact values only; round aggressively; highlight the row or column the audience should look at. A table past ~6×6 cells is data, not a slide — chart it or appendix it.
- **Diagrams**: fewest boxes that carry the structure; arrows mean one thing per diagram (data flow, dependency, sequence — pick one); labels on arrows, not just boxes.
- **Consistency is the polish that reads as credibility**: one palette, one type scale, one icon style. Mixed visual languages read as assembled, not authored.

## Animation

Animation is emphasis, not entertainment. Use it to direct attention (reveal the next point, highlight the changed bar) and nowhere else. Transitions ≤300ms. Honor `prefers-reduced-motion`. An animation the audience notices as animation has failed.

## Audience calibration

Depth, jargon, and pacing are set by the audience, not the subject:

- **Decision-makers**: conclusion first, evidence compressible to appendix, the ask explicit.
- **Technical peers**: mechanism over motivation; show the how, skip the why-we-care.
- **Mixed rooms**: layer it — headline for everyone, visual for the non-specialist, detail in notes and appendix for the specialist.

Calibrate vocabulary, not rigor: simplify words, never falsify content.

## Failure modes

The recurring ways decks fail — check against each before delivering:

- **Topic-outline deck**: headlines name topics, not messages; no arc.
- **Document-in-slides**: paragraphs pasted onto slides; read, not presented.
- **Wall-of-data table**: raw dumps where a chart or single number belongs.
- **Animation-as-filler**: motion with no attention-directing job.
- **Orphan deck**: no notes, no sources — undeliverable by anyone but its author, unverifiable by everyone.
