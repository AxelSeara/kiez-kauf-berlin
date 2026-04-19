import {
  CHECKPOINT_FILE,
  clamp,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint,
  sqlArray,
  sqlLiteral,
  stableNormalizeText
} from "./_utils.mjs";

const AI_GROUP_WEIGHTS = {
  grocery: { groceries: 0.8, beverages: 0.66, fresh_produce: 0.64, household: 0.55, snacks: 0.52 },
  "fresh-food": { fresh_produce: 0.82, groceries: 0.58, bakery: 0.55 },
  convenience: { beverages: 0.82, snacks: 0.78, groceries: 0.6, household: 0.48 },
  bakery: { bakery: 0.89, beverages: 0.52, snacks: 0.45 },
  butcher: { meat: 0.9, groceries: 0.42 },
  produce: { fresh_produce: 0.9, groceries: 0.4 },
  drinks: { beverages: 0.93, snacks: 0.48 },
  pharmacy: { pharmacy: 0.92, personal_care: 0.79 },
  "personal-care": { personal_care: 0.88, pharmacy: 0.44 },
  beauty: { personal_care: 0.93, pharmacy: 0.52 },
  "medical-supplies": { pharmacy: 0.93, personal_care: 0.68, household: 0.34 },
  household: { household: 0.9, groceries: 0.35 },
  hardware: { household: 0.94, groceries: 0.2 },
  art: { household: 0.74, groceries: 0.22 },
  antiques: { household: 0.58 },
  department_store: { household: 0.78, personal_care: 0.74, groceries: 0.6, beverages: 0.48, pharmacy: 0.42 },
  mall: { household: 0.62, personal_care: 0.58, groceries: 0.44, beverages: 0.35 },
  bio: { groceries: 0.67, fresh_produce: 0.74, beverages: 0.55 }
};

const GENERIC_TERMS = new Set([
  "shop",
  "store",
  "market",
  "product",
  "products",
  "item",
  "items",
  "angebot",
  "angebote",
  "kaufen",
  "retail",
  "food",
  "grocery"
]);

function normalizeTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "")).filter(Boolean);
}

function hasStrongWebsiteSignals(establishment) {
  if (!establishment.websiteSignals) {
    return false;
  }

  const s = establishment.websiteSignals;
  const strongHttp = typeof s.http_status === "number" && s.http_status >= 200 && s.http_status < 300;
  const hasStructure =
    (s.headings?.length ?? 0) >= 2 ||
    (s.visible_categories?.length ?? 0) >= 2 ||
    (s.schema_entities?.length ?? 0) >= 1;

  return strongHttp && hasStructure;
}

function pickRecommendationLimit(establishment, maxRecommendations) {
  if (hasStrongWebsiteSignals(establishment)) {
    return Math.min(maxRecommendations, 5);
  }

  if (!establishment.websiteSignals || !establishment.website) {
    return Math.min(maxRecommendations, 2);
  }

  return Math.min(maxRecommendations, 3);
}

function productIsTooGeneric(product) {
  const terms = stableNormalizeText(product.normalized_name).split(" ");
  if (!terms.length) return true;
  return terms.every((term) => GENERIC_TERMS.has(term));
}

function websiteTextSignals(establishment) {
  const s = establishment.websiteSignals;
  if (!s) {
    return { text: "", schemaProductNames: [] };
  }

  const schemaProductNames = [];
  for (const entity of s.schema_entities ?? []) {
    const type = String(entity?.["@type"] ?? "");
    if (/Product|Offer/i.test(type)) {
      if (entity?.name) schemaProductNames.push(String(entity.name));
      if (entity?.itemOffered?.name) schemaProductNames.push(String(entity.itemOffered.name));
      if (entity?.category) schemaProductNames.push(String(entity.category));
      if (entity?.brand?.name) schemaProductNames.push(String(entity.brand.name));
    }
  }

  const text = [
    s.page_title ?? "",
    s.meta_description ?? "",
    ...(s.headings ?? []),
    ...(s.breadcrumbs ?? []),
    ...(s.visible_categories ?? []),
    ...(s.visible_brands ?? []),
    ...schemaProductNames
  ]
    .map((item) => stableNormalizeText(item))
    .join(" ")
    .trim();

  return {
    text,
    schemaProductNames: schemaProductNames.map((item) => stableNormalizeText(item)).filter(Boolean)
  };
}

async function fetchCanonicalProducts() {
  const sql = `
select id, normalized_name, product_group, synonyms
from canonical_products
order by id asc;
`;
  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => ({
    id: Number(row.id),
    normalized_name: String(row.normalized_name),
    product_group: String(row.product_group),
    synonyms: normalizeTextArray(row.synonyms)
  }));
}

async function fetchEstablishmentBatch(lastId, batchSize) {
  const sql = `
select
  e.id,
  e.name,
  e.district,
  e.osm_category,
  e.app_categories,
  e.website,
  e.freshness_score,
  e.last_enriched_at,
  w.source_url as website_source_url,
  w.http_status,
  w.page_title,
  w.meta_description,
  w.headings,
  w.breadcrumbs,
  w.visible_categories,
  w.visible_brands,
  w.schema_entities,
  w.schema_opening_hours,
  w.extracted_opening_hours,
  w.fetched_at
from establishments e
left join establishment_website_enrichment w on w.establishment_id = e.id
where e.external_source = 'osm-overpass'
  and e.id > ${Number(lastId)}
  and e.active_status in ('active', 'temporarily_closed')
order by e.id asc
limit ${Number(batchSize)};
`;

  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    district: String(row.district ?? "Berlin"),
    osm_category: String(row.osm_category ?? ""),
    app_categories: normalizeTextArray(row.app_categories),
    website: row.website ? String(row.website) : null,
    freshness_score: row.freshness_score == null ? null : Number(row.freshness_score),
    last_enriched_at: row.last_enriched_at ? String(row.last_enriched_at) : null,
    websiteSignals: row.website_source_url
      ? {
          source_url: String(row.website_source_url),
          http_status: row.http_status == null ? null : Number(row.http_status),
          page_title: row.page_title ? String(row.page_title) : null,
          meta_description: row.meta_description ? String(row.meta_description) : null,
          headings: normalizeTextArray(row.headings),
          breadcrumbs: normalizeTextArray(row.breadcrumbs),
          visible_categories: normalizeTextArray(row.visible_categories),
          visible_brands: normalizeTextArray(row.visible_brands),
          schema_entities: Array.isArray(row.schema_entities) ? row.schema_entities : [],
          schema_opening_hours: row.schema_opening_hours ? String(row.schema_opening_hours) : null,
          extracted_opening_hours: row.extracted_opening_hours ? String(row.extracted_opening_hours) : null,
          fetched_at: row.fetched_at ? String(row.fetched_at) : null
        }
      : null
  }));
}

function websiteSignalCandidates(establishment, canonicalProducts, limit) {
  if (!establishment.websiteSignals) {
    return [];
  }

  const { text, schemaProductNames } = websiteTextSignals(establishment);
  if (!text && !schemaProductNames.length) {
    return [];
  }

  const rows = [];
  const appCategorySet = new Set(establishment.app_categories);

  for (const product of canonicalProducts) {
    if (productIsTooGeneric(product)) continue;

    const normalizedName = stableNormalizeText(product.normalized_name);
    const synonymTerms = (product.synonyms ?? []).map((item) => stableNormalizeText(item)).filter(Boolean);
    let score = 0;
    const reasonBits = [];

    if (normalizedName && text.includes(normalizedName)) {
      score += 0.38;
      reasonBits.push("website text mentions canonical product");
    }

    if (synonymTerms.some((term) => term && text.includes(term))) {
      score += 0.27;
      reasonBits.push("website text matches product synonym");
    }

    if (schemaProductNames.some((term) => term && (term.includes(normalizedName) || normalizedName.includes(term)))) {
      score += 0.34;
      reasonBits.push("schema.org product/offer signal");
    }

    for (const category of appCategorySet) {
      const weight = AI_GROUP_WEIGHTS[category]?.[product.product_group] ?? 0;
      if (weight > 0) {
        score += weight * 0.22;
        reasonBits.push(`category ${category} supports group ${product.product_group}`);
        break;
      }
    }

    if (score < 0.46) continue;

    const confidence = Number(clamp(score, 0.46, 0.94).toFixed(4));
    rows.push({
      canonical_product_id: product.id,
      source_type: "website_extracted",
      generation_method: "website_signal_extractor_v1",
      extraction_method: "website_html_jsonld_extraction_v1",
      source_url: establishment.websiteSignals.source_url ?? establishment.website ?? null,
      confidence,
      why: `Website signal matched: ${reasonBits.slice(0, 2).join("; ")}.`,
      category_path: ["website", "signal-extraction", product.product_group]
    });
  }

  return rows.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

function heuristicCandidates(establishment, canonicalProducts, limit) {
  const scores = new Map();
  const nameNorm = stableNormalizeText(establishment.name);

  for (const category of establishment.app_categories) {
    const weights = AI_GROUP_WEIGHTS[category] ?? null;
    if (!weights) continue;

    for (const product of canonicalProducts) {
      if (productIsTooGeneric(product)) continue;
      const groupWeight = weights[product.product_group] ?? 0;
      if (groupWeight <= 0) continue;

      const prev = scores.get(product.id) ?? {
        product,
        score: 0,
        reasonBits: []
      };

      if (groupWeight > prev.score) {
        prev.score = groupWeight;
      }
      prev.reasonBits.push(`category ${category} -> group ${product.product_group}`);
      scores.set(product.id, prev);
    }
  }

  if (!scores.size) {
    for (const product of canonicalProducts) {
      if (!["groceries", "beverages"].includes(product.product_group)) continue;
      if (productIsTooGeneric(product)) continue;
      scores.set(product.id, {
        product,
        score: 0.43,
        reasonBits: ["conservative fallback essentials"]
      });
    }
  }

  for (const entry of scores.values()) {
    const productNorm = stableNormalizeText(entry.product.normalized_name);
    const words = productNorm.split(" ").filter((w) => w.length >= 4);
    if (words.some((word) => nameNorm.includes(word))) {
      entry.score = clamp(entry.score + 0.06, 0, 1);
      entry.reasonBits.push("store name keyword overlap");
    }

    if (establishment.osm_category === "pharmacy" && entry.product.product_group === "pharmacy") {
      entry.score = clamp(entry.score + 0.05, 0, 1);
      entry.reasonBits.push("osm pharmacy boost");
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      canonical_product_id: entry.product.id,
      source_type: "rules_generated",
      generation_method: "conservative_profile_heuristic_v2",
      extraction_method: "rules_profile_heuristic_v2",
      source_url: establishment.websiteSignals?.source_url ?? establishment.website ?? null,
      confidence: Number(clamp(entry.score * 0.82, 0.48, 0.76).toFixed(4)),
      why: `Conservative profile match: ${entry.reasonBits.slice(0, 2).join("; ")}.`,
      category_path: ["rules", "conservative-heuristic", ...(establishment.app_categories.slice(0, 1) || ["uncategorized"])]
    }));
}

function buildPrompt(establishment, productPool, maxRecommendations) {
  const website = establishment.websiteSignals;
  const webSnippet = website
    ? {
        title: website.page_title,
        description: website.meta_description,
        headings: (website.headings ?? []).slice(0, 6),
        breadcrumbs: (website.breadcrumbs ?? []).slice(0, 5),
        categories: (website.visible_categories ?? []).slice(0, 6),
        brands: (website.visible_brands ?? []).slice(0, 10),
        schema_entities: (website.schema_entities ?? [])
          .slice(0, 8)
          .map((item) => ({ "@type": item?.["@type"], name: item?.name, category: item?.category }))
      }
    : null;

  return [
    "You rank plausible products for a Berlin local store.",
    "Do not claim stock certainty and do not invent exact inventory.",
    "If evidence is weak, return fewer recommendations.",
    `Store: ${establishment.name}`,
    `District: ${establishment.district}`,
    `OSM category: ${establishment.osm_category || "unknown"}`,
    `App categories: ${establishment.app_categories.join(", ") || "none"}`,
    `Website signals: ${JSON.stringify(webSnippet)}`,
    `Return up to ${maxRecommendations} items from this canonical pool:`,
    JSON.stringify(productPool, null, 2),
    'Respond ONLY JSON: {"recommendations":[{"canonical_product_id":number,"confidence":number,"why":string}]}.'
  ].join("\n");
}

async function llmCandidates(establishment, canonicalProducts, maxRecommendations, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const categorySet = new Set(establishment.app_categories);
  const pool = canonicalProducts
    .filter((product) => {
      if (productIsTooGeneric(product)) return false;
      if (!categorySet.size) return ["groceries", "beverages", "snacks"].includes(product.product_group);
      for (const category of categorySet) {
        if ((AI_GROUP_WEIGHTS[category]?.[product.product_group] ?? 0) > 0) {
          return true;
        }
      }
      return false;
    })
    .slice(0, 60)
    .map((product) => ({
      id: product.id,
      name: product.normalized_name,
      group: product.product_group,
      synonyms: product.synonyms.slice(0, 4)
    }));

  if (!pool.length) return [];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You produce compact JSON for database ingestion. Avoid markdown. Confidence must be in [0,1]."
        },
        {
          role: "user",
          content: buildPrompt(establishment, pool, maxRecommendations)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API failed ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI response did not include content");
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error("OpenAI response was not JSON");
  }

  const parsed = JSON.parse(content.slice(start, end + 1));
  const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  const validPoolIds = new Set(pool.map((item) => Number(item.id)));

  return recommendations
    .filter((item) => Number.isFinite(Number(item.canonical_product_id)))
    .map((item) => ({
      canonical_product_id: Number(item.canonical_product_id),
      confidence: Number(clamp(Number(item.confidence ?? 0.58), 0.45, 0.9).toFixed(4)),
      why: String(item.why ?? "LLM matched store context to canonical product.").slice(0, 220)
    }))
    .filter((item) => validPoolIds.has(item.canonical_product_id))
    .slice(0, maxRecommendations)
    .map((item) => ({
      canonical_product_id: item.canonical_product_id,
      source_type: "ai_generated",
      generation_method: "openai_llm_candidate_refiner_v2",
      extraction_method: `openai_chat_completions_${model}`,
      source_url: establishment.websiteSignals?.source_url ?? establishment.website ?? null,
      confidence: item.confidence,
      why: `LLM inference from store + website context: ${item.why}`,
      category_path: ["ai", "llm", ...(establishment.app_categories.slice(0, 1) || ["uncategorized"])]
    }));
}

function chooseValidationStatus(sourceType, confidence) {
  if (sourceType === "website_extracted") {
    return confidence >= 0.78 ? "likely" : "unvalidated";
  }
  if (sourceType === "ai_generated") {
    return confidence >= 0.82 ? "likely" : "unvalidated";
  }
  return confidence >= 0.72 ? "likely" : "unvalidated";
}

function dedupeAndTrimCandidates(candidates, maxPerStore) {
  const sourcePriority = {
    website_extracted: 4,
    ai_generated: 3,
    rules_generated: 2,
    imported: 1
  };

  const byProduct = new Map();
  for (const candidate of candidates) {
    const key = Number(candidate.canonical_product_id);
    const previous = byProduct.get(key);
    if (!previous) {
      byProduct.set(key, candidate);
      continue;
    }

    const prevScore =
      (sourcePriority[previous.source_type] ?? 0) * 1000 + Math.round(previous.confidence * 1000);
    const nextScore =
      (sourcePriority[candidate.source_type] ?? 0) * 1000 + Math.round(candidate.confidence * 1000);
    if (nextScore > prevScore) {
      byProduct.set(key, candidate);
    }
  }

  return [...byProduct.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxPerStore);
}

function buildUpsertSql(rows) {
  if (!rows.length) {
    return "select 0::int as affected_rows;";
  }

  const values = rows
    .map((row) => {
      return `(${[
        sqlLiteral(row.establishment_id),
        sqlLiteral(row.canonical_product_id),
        `'${row.source_type}'::source_type_enum`,
        sqlLiteral(row.generation_method),
        sqlLiteral(row.confidence),
        `'${row.validation_status}'::validation_status_enum`,
        sqlLiteral(row.validation_notes ?? null),
        sqlLiteral(row.why),
        sqlArray(row.category_path),
        sqlLiteral(row.inferred_from),
        sqlLiteral(row.source_url),
        sqlLiteral(row.extraction_method),
        `${sqlLiteral(row.last_checked_at)}::timestamptz`,
        `${sqlLiteral(row.freshness_score)}::numeric(5,4)`
      ].join(",")})`;
    })
    .join(",\n");

  return `
with incoming (
  establishment_id,
  canonical_product_id,
  source_type,
  generation_method,
  confidence,
  validation_status,
  validation_notes,
  why_this_product_matches,
  category_path,
  inferred_from,
  source_url,
  extraction_method,
  last_checked_at,
  freshness_score
) as (
  values
  ${values}
), upserted as (
  insert into establishment_product_candidates (
    establishment_id,
    canonical_product_id,
    source_type,
    generation_method,
    confidence,
    validation_status,
    validation_notes,
    why_this_product_matches,
    category_path,
    inferred_from,
    source_url,
    extraction_method,
    last_checked_at,
    freshness_score
  )
  select * from incoming
  on conflict (establishment_id, canonical_product_id, source_type, generation_method)
  do update set
    confidence = excluded.confidence,
    validation_status = excluded.validation_status,
    validation_notes = excluded.validation_notes,
    why_this_product_matches = excluded.why_this_product_matches,
    category_path = excluded.category_path,
    inferred_from = excluded.inferred_from,
    source_url = excluded.source_url,
    extraction_method = excluded.extraction_method,
    last_checked_at = excluded.last_checked_at,
    freshness_score = excluded.freshness_score,
    updated_at = now()
  where establishment_product_candidates.validation_status not in ('validated', 'rejected')
    and (
      establishment_product_candidates.confidence is distinct from excluded.confidence
      or establishment_product_candidates.validation_status is distinct from excluded.validation_status
      or establishment_product_candidates.validation_notes is distinct from excluded.validation_notes
      or establishment_product_candidates.why_this_product_matches is distinct from excluded.why_this_product_matches
      or establishment_product_candidates.category_path is distinct from excluded.category_path
      or establishment_product_candidates.inferred_from is distinct from excluded.inferred_from
      or establishment_product_candidates.source_url is distinct from excluded.source_url
      or establishment_product_candidates.extraction_method is distinct from excluded.extraction_method
      or establishment_product_candidates.last_checked_at is distinct from excluded.last_checked_at
      or establishment_product_candidates.freshness_score is distinct from excluded.freshness_score
    )
  returning id
)
select count(*)::int as affected_rows from upserted;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 120);
  const maxRecommendations = Number(args["max-recommendations"] ?? 5);
  const resume = Boolean(args.resume);
  const forceHeuristic = Boolean(args["force-heuristic"]);
  const maxEstablishments = args["max-establishments"] ? Number(args["max-establishments"]) : null;
  const model = String(args.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini");

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.generateAiCandidates ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;

  const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
  const useLlm = hasApiKey && !forceHeuristic;

  const canonicalProducts = await fetchCanonicalProducts();
  logInfo("Phase 6 - generate enriched candidates", {
    batchSize,
    maxRecommendations,
    maxEstablishments,
    useLlm,
    model,
    canonicalProducts: canonicalProducts.length,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  let totalEstablishments = 0;
  let totalGenerated = 0;
  let llmUsedCount = 0;
  let websiteExtractedCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const establishments = await fetchEstablishmentBatch(cursor, batchSize);
    if (!establishments.length) {
      break;
    }

    const upsertRows = [];

    for (const establishment of establishments) {
      const storeLimit = pickRecommendationLimit(establishment, maxRecommendations);
      const nowIso = new Date().toISOString();
      const freshness = Number(clamp(establishment.freshness_score ?? 0.64, 0.05, 0.99).toFixed(4));

      const websiteCandidates = websiteSignalCandidates(establishment, canonicalProducts, storeLimit);
      websiteExtractedCount += websiteCandidates.length;

      let aiRows = [];
      if (useLlm) {
        try {
          aiRows = (await llmCandidates(establishment, canonicalProducts, storeLimit, model)) ?? [];
          if (aiRows.length) {
            llmUsedCount += 1;
          }
        } catch (error) {
          logWarn(`LLM generation failed for establishment ${establishment.id}, using conservative fallback`, String(error));
        }
      }

      const fallbackNeeded = !aiRows.length;
      const fallbackRows = fallbackNeeded
        ? heuristicCandidates(establishment, canonicalProducts, Math.min(storeLimit, 2))
        : [];

      const selected = dedupeAndTrimCandidates(
        [...websiteCandidates, ...aiRows, ...fallbackRows],
        storeLimit
      );

      for (const candidate of selected) {
        const validationStatus = chooseValidationStatus(candidate.source_type, candidate.confidence);
        upsertRows.push({
          establishment_id: establishment.id,
          canonical_product_id: candidate.canonical_product_id,
          source_type: candidate.source_type,
          generation_method: candidate.generation_method,
          confidence: candidate.confidence,
          validation_status: validationStatus,
          validation_notes:
            validationStatus === "likely"
              ? "Plausible match inferred from category/website signals."
              : "Pending explicit validation.",
          why: candidate.why,
          category_path: candidate.category_path,
          inferred_from: {
            mode:
              candidate.source_type === "ai_generated"
                ? "llm"
                : candidate.source_type === "website_extracted"
                  ? "website_signal"
                  : "conservative_rules",
            model: candidate.source_type === "ai_generated" ? model : null,
            no_real_time_stock_claim: true,
            generated_at: nowIso
          },
          source_url: candidate.source_url,
          extraction_method: candidate.extraction_method,
          last_checked_at: nowIso,
          freshness_score: freshness
        });
      }
    }

    const upsertSql = buildUpsertSql(upsertRows);
    const upsertResult = await runSupabaseQuery({ sql: upsertSql, output: "json" });
    const affectedRows = Number(upsertResult.parsed.rows?.[0]?.affected_rows ?? 0);

    totalEstablishments += establishments.length;
    totalGenerated += affectedRows;
    cursor = establishments[establishments.length - 1].id;

    checkpoint.generateAiCandidates = {
      lastId: cursor,
      mode: useLlm ? "gpt_plus_website" : "rules_plus_website",
      totalEstablishments,
      totalGenerated,
      llmUsedCount,
      websiteExtractedCount,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Generated enriched candidate batch", {
      establishments: establishments.length,
      upsertRows: upsertRows.length,
      affectedRows,
      cursor,
      cumulativeGenerated: totalGenerated,
      llmUsedCount,
      websiteExtractedCount
    });

    if (maxEstablishments && totalEstablishments >= maxEstablishments) {
      logInfo("Stopping enriched generation due to max-establishments cap", {
        maxEstablishments,
        totalEstablishments
      });
      break;
    }
  }

  checkpoint.generateAiCandidates = {
    lastId: cursor,
    mode: useLlm ? "gpt_plus_website" : "rules_plus_website",
    totalEstablishments,
    totalGenerated,
    llmUsedCount,
    websiteExtractedCount,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Phase 6 completed", {
    totalEstablishments,
    totalGenerated,
    llmUsedCount,
    websiteExtractedCount,
    mode: useLlm ? "gpt_plus_website" : "rules_plus_website"
  });
}

main().catch((error) => {
  logWarn("Enriched candidate generation failed", String(error));
  process.exit(1);
});
