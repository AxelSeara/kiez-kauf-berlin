# UX Personas & JTBD (MVP)

Last updated: 2026-04-18
Owner: Product/UX
Status: Living document for decisions and UX reviews

## Why this exists

This document keeps our target users explicit so we can make faster, better product decisions.
Use it when discussing UX, search behavior, ranking logic, map/list flow, and admin curation priorities.

## Core personas

## 1) Lara — practical neighborhood buyer

- Age: 32
- Role: UX Designer
- Area: Neukolln
- Context: no car, mostly bike/U-Bahn, prefers local but needs speed
- Goal: find a specific item nearby, quickly
- Key needs: exact product search, map + nearby stores, distance/time, confidence signal
- Quote: "I want this faster than Amazon, but bought locally."

## 2) Jonas — urgent buyer

- Age: 28
- Role: Freelance sound technician
- Area: Friedrichshain
- Context: buys under pressure (cables, batteries, adapters, basic tools)
- Goal: solve today, not tomorrow
- Key needs: open now, confidence level, quick contact, instant route
- Quote: "Just tell me where it is and whether they probably have it."

## 3) Meryem — ethical local consumer

- Age: 36
- Role: Research/cultural sector
- Area: Kreuzberg
- Context: wants to support local independent commerce
- Goal: avoid marketplaces without losing usability
- Key needs: independent vs chain signal, store type clarity, useful alternatives
- Quote: "I do not need the fastest thing, I need a real alternative to Amazon."

## 4) Felix — specific item hunter

- Age: 41
- Role: Architect
- Area: Prenzlauer Berg
- Context: searches for niche/specific objects
- Goal: avoid noisy generic web results
- Key needs: synonym-tolerant search, better taxonomy, related terms
- Quote: "I am not searching office supplies, I am searching a 2 mm mechanical pencil."

## 5) Clara — newcomer in Berlin

- Age: 26
- Role: Master student/junior office role
- Area: Moabit
- Context: new in city, low neighborhood/store-type knowledge
- Goal: orientation and confidence
- Key needs: clear UI, map-first understanding, district/type clues
- Quote: "I do not know where to buy this in Berlin without ending up in a big-box store."

## 6) David — parent with little time

- Age: 39
- Role: Product Manager
- Area: Pankow
- Context: frequent household/kids errands in short time windows
- Goal: solve quickly with minimal cognitive load
- Key needs: direct flow, favorites, opening hours, on-the-way convenience
- Quote: "I do not need discovery, I need resolution."

## MVP target personas (priority)

1. Lara (primary)
2. Jonas (primary)
3. Meryem (secondary but strategic)

Reason: this combination aligns product utility, urgency, and mission narrative without over-scoping early.

## Jobs To Be Done

- "I need this item today and want to find it nearby."
- "I want to avoid Amazon without adding friction."
- "I do not know Berlin well and need simple local guidance."
- "I need a specific item that generic search engines fail to resolve."
- "I want convenience plus local impact."

## Product implications (must-haves)

1. Search first, no landing friction.
2. Hybrid map + short list for fast comparison.
3. Confidence signals (recently validated / likely available / specialized store).
4. Minimal clicks; every extra step competes against Amazon convenience.
5. Mission/discovery as secondary layer after task resolution.

## UX decision checklist

Before shipping any UX change, check:

- Does this reduce time-to-first-use?
- Does this improve confidence in result quality?
- Does this reduce clicks to route/contact action?
- Does this help urgent users under pressure?
- Does this keep map and result interpretation clear on mobile?

If at least 3 answers are "no", do not ship yet.

## Feature opportunity map (derived)

High value, near-term:

- Open now filter/state
- Near me + stable location behavior
- Stock confidence label
- Independent shop badge
- Call shop action
- Alternative nearby suggestion when no results

Later value (post-MVP):

- Save shop/favorites
- On my route
- Recently validated timeline
- Price range signal (if data quality supports it)

## How to use this doc in reviews

For each UX review or bug triage:

1. Pick the main persona impacted.
2. Write expected outcome in one sentence.
3. Validate against the checklist.
4. Log decision in issue/PR with persona tag (`Lara`, `Jonas`, etc.).

## Notes for future research

- Validate whether "open now" materially changes conversion to route.
- Measure if confidence labels reduce no-result abandonment.
- Compare map-only vs map+compact-list behavior on mobile.
