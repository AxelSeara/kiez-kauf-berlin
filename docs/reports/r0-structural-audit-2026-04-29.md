# R0 Structural Audit (Moabit-first)
Date: 2026-04-29
Scope: Moabit + nearby Mitte subzones (Moabit, Wedding, Gesundbrunnen, Tiergarten, Hansaviertel, Mitte)

## 1) Baseline snapshot (current system)

### 1.1 Establishment coverage in scope
- Establishments: **1182**
- `is_relevant_for_kiezkauf=true`: **1181**
- With website: **237**
- Empty `app_categories`: **63**
- Empty `store_role_primary`: **0**

### 1.2 Dominant OSM categories (top)
- convenience: 232
- bakery: 199
- supermarket: 148
- beauty: 120
- kiosk: 86
- pharmacy: 75
- chemist: 39

### 1.3 Dominant app categories (top)
- grocery: 639
- drinks: 489
- fresh-food: 390
- convenience: 331
- household: 220
- bakery: 216
- beauty: 169
- personal-care: 155

### 1.4 Catalog footprint
- Active canonical families: **84**
- Active aliases: **466**
- Product groups: mostly groceries/fresh_produce/beverages/household; sparse on batteries, lighting, second-hand terms

### 1.5 Query behavior (last 14 days, `query_resolution_log`)
- Total queries logged: **103**
- `zero_any` (no products and no services): **30** (**29.13%**)
- `services_fallback_only`: **23**

## 2) Persona benchmark baseline (API runtime)

Artifact: `data/berlin/reports/r0-persona-benchmark.json`

- Total test queries: **23**
- Queries with any result: **14**
- Hit rate: **60.87%**

By persona:
- Lara: 66.67%
- Jonas: 66.67%
- **Meryem: 33.33%**
- Felix: 66.67%
- Clara: 66.67%
- David: 66.67%
- Regression pack: 60.00%

## 3) Root-cause analysis (holistic)

### A. Ingestion coverage gap (not ranking)
Evidence:
- Overpass returns `Humana` in Moabit (`shop=clothes`, Turmstraße 61).
- DB has **0** rows with `osm_category in ('clothes','second_hand','charity')`.
- `berlin_establishment_stage` also has **0** such rows.

Conclusion:
- Import filters are excluding second-hand/clothing/charity universe.
- `second hand` failures are primarily ingestion coverage failures.

### B. Catalog semantic gap (not LLM quality)
Evidence (term->canonical mapping check):
- `laundry detergent`: 1 canonical product match (exists)
- `tampons`, `diapers`, `shoe glue`: present
- `second hand`, `humana`, `baby wipes`, `aa battery`, `light bulb`, `usb-c cable`: **0 canonical matches**

Conclusion:
- Core catalog is still too narrow for real neighborhood intent.
- Many high-frequency household/urgent intents have no canonical surface.

### C. Retrieval/filter contradiction (systemic logic bug)
Evidence:
- `laundry detergent` has canonical alias and dataset rows near Moabit (e.g. dm/Rossmann/etc. carry `waschmittel 20 wl`).
- API still returns 0 for `laundry detergent`.
- Current pipeline applies strict token guard after retrieval; canonical alias match can still be rejected if `normalized_name` tokens don't overlap strongly (EN query vs DE product text).

Conclusion:
- Search strategies are correctly retrieving candidates, then downstream guardrails over-prune multilingual matches.
- This is a ranking/filter architecture issue, not missing store data alone.

### D. Discovery-vs-product ambiguity
Evidence:
- `art`/`antiques` often resolve to discovery-type rows ("Art shop", "Antiques shop") and look like product hits.

Conclusion:
- Result semantics are mixed: store-discovery signals are being presented in product-first channel.

## 4) Gap matrix (query -> recovery -> filter -> final)

| Query | Recovery status | Filter/ranking issue | Final |
|---|---|---|---|
| second hand | No canonical term + no clothes/second_hand shops imported | N/A | 0 |
| refill detergent | Weak canonical coverage + no dedicated refill capabilities | Strict filters remove weak group fallback | 0 |
| laundry detergent | Canonical alias exists; rows exist in dataset | Canonical/group rows likely pruned by strict text guard | 0 |
| baby wipes | No canonical family/alias | N/A | 0 |
| aa battery | No canonical family/alias | N/A | 0 |
| light bulb | No canonical family/alias | N/A | 0 |
| phone repair | Service fallback recovery works | OK | service hits |
| antiques | Category-intent recovery works | discovery-heavy semantics | hits |

## 5) What is already solid (keep)
- Layered pipeline with traceability (`rules_generated`, `ai_generated`, `website_extracted`, validation states).
- Service fallback architecture is useful for urgent/problem-solving intents.
- DB footprint remains lean (~213 MB), allowing safe iteration.
- Typo correction and query normalization already help (`mjlk` -> `milk`, etc.).

## 6) Evolution plan before execution (no patching)

### P0 — Retrieval/filter coherence fix
- Preserve strict anti-noise guardrails, but add an exception path when candidate was recovered through strong canonical alias matching.
- Add `matched_by` context (`canonical_alias`, `product_name`, `group_keyword`, `category_intent`) into filtering stage.
- Do not force DE-token overlap if match came from multilingual alias.

### P0 — Ingestion taxonomy expansion (scope-limited)
- Extend import shop types to include: `clothes`, `second_hand`, `charity` (and related retail tags as agreed).
- Re-import **only Moabit ring scope** and dedupe incrementally.

### P1 — Catalog lean_v2 core expansion
- Expand from 84 to ~300+ families in phased core, prioritizing unmet demand clusters:
  - household cleaning/laundry
  - batteries/cables/lighting
  - baby essentials
  - second-hand relevant families
- Keep aliases in child table; avoid SKU explosion.

### P1 — Search semantics split
- Separate "product hit" vs "store discovery" in API output semantics.
- Keep UX compact but prevent discovery rows from masquerading as product certainty.

## 7) Acceptance criteria for next phase (R1 readiness)
- Persona benchmark hit rate >= 75% on same fixed 23-query suite.
- Meryem >= 2/3.
- `zero_any` from logs drops materially from 29.13% baseline.
- `second hand` queries produce nearby relevant stores (including Humana-class shops).
- `laundry detergent` resolves to actual dm/Rossmann/similar rows within scope.
