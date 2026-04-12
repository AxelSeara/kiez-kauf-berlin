import { createHash } from "node:crypto";
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

const MAX_TEXT_LEN = 320;
const DEFAULT_TIMEOUT_MS = 18000;

const CATEGORY_HINTS = [
  "grocery",
  "supermarket",
  "kiosk",
  "beverages",
  "bakery",
  "butcher",
  "pharmacy",
  "organic",
  "bio",
  "produce",
  "drinks",
  "haushalt",
  "drogerie",
  "vitamin",
  "snack",
  "fresh"
];

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]*>/g, " "));
}

function normalizeWebsiteUrl(rawWebsite) {
  const raw = String(rawWebsite ?? "").trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) {
    return `https://${raw}`;
  }

  return null;
}

function uniqueLimited(values, limit = 24) {
  const out = [];
  const seen = new Set();
  for (const item of values) {
    const cleaned = stripTags(item).slice(0, MAX_TEXT_LEN);
    if (!cleaned) continue;
    const key = stableNormalizeText(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]).slice(0, MAX_TEXT_LEN) : null;
}

function extractMetaDescription(html) {
  const match = html.match(
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
  return match ? stripTags(match[1]).slice(0, MAX_TEXT_LEN) : null;
}

function extractHeadings(html) {
  const matches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => m[1]);
  return uniqueLimited(matches, 28);
}

function collectJsonLdEntities(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const entities = [];

  for (const scriptMatch of scripts) {
    const raw = String(scriptMatch[1] ?? "").trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        entities.push(...parsed);
      } else if (parsed && Array.isArray(parsed["@graph"])) {
        entities.push(...parsed["@graph"]);
      } else if (parsed && typeof parsed === "object") {
        entities.push(parsed);
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return entities
    .filter((entity) => entity && typeof entity === "object")
    .slice(0, 80);
}

function extractBreadcrumbsFromJsonLd(entities) {
  const breadcrumbs = [];

  for (const entity of entities) {
    const type = String(entity["@type"] ?? "");
    if (!/BreadcrumbList/i.test(type)) continue;

    const items = Array.isArray(entity.itemListElement) ? entity.itemListElement : [];
    for (const item of items) {
      const name = item?.name ?? item?.item?.name ?? null;
      if (name) breadcrumbs.push(String(name));
    }
  }

  return uniqueLimited(breadcrumbs, 16);
}

function extractBreadcrumbsFromHtml(html) {
  const matches = [...html.matchAll(/<[^>]+class=["'][^"']*breadcrumb[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)].map(
    (m) => m[1]
  );
  const values = [];
  for (const block of matches) {
    const pieces = block.split(/\/|>|&gt;|›|»/g);
    values.push(...pieces);
  }
  return uniqueLimited(values, 16);
}

function extractBrands(entities, headings, title, metaDescription) {
  const brands = [];

  for (const entity of entities) {
    const brand = entity.brand?.name ?? entity.brand ?? null;
    if (brand && typeof brand === "string") {
      brands.push(brand);
    }
  }

  const textPool = [title ?? "", metaDescription ?? "", ...headings].join(" ");
  const brandMatches = [...textPool.matchAll(/\b([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,})?)\b/g)];
  for (const match of brandMatches) {
    brands.push(match[1]);
  }

  return uniqueLimited(brands, 24).filter((value) => value.length >= 3);
}

function extractVisibleCategories(headings, breadcrumbs, title, metaDescription) {
  const allText = [title ?? "", metaDescription ?? "", ...headings, ...breadcrumbs]
    .join(" ")
    .toLowerCase();

  const out = [];
  for (const hint of CATEGORY_HINTS) {
    if (allText.includes(hint)) {
      out.push(hint);
    }
  }
  return uniqueLimited(out, 18);
}

function extractSchemaOpeningHours(entities) {
  const values = [];

  for (const entity of entities) {
    if (typeof entity.openingHours === "string") {
      values.push(entity.openingHours);
    }

    if (Array.isArray(entity.openingHoursSpecification)) {
      for (const spec of entity.openingHoursSpecification) {
        const day = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek.join(",") : spec.dayOfWeek ?? "";
        const opens = spec.opens ?? "";
        const closes = spec.closes ?? "";
        const piece = [day, opens && closes ? `${opens}-${closes}` : ""].filter(Boolean).join(" ");
        if (piece) values.push(piece);
      }
    }
  }

  const deduped = uniqueLimited(values, 8);
  return deduped.length ? deduped.join("; ") : null;
}

function extractOpeningHoursFromHtml(html) {
  const text = stripTags(html);
  const match = text.match(
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Mo|Di|Mi|Do|Fr|Sa|So)(?:[^.;]{0,90})(?:\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2})/i
  );
  return match ? match[0].slice(0, MAX_TEXT_LEN) : null;
}

function scoreFreshnessFromFetch(args) {
  if (args.httpStatus >= 200 && args.httpStatus < 300) {
    return args.contentHashChanged ? 0.92 : 0.84;
  }
  if (args.httpStatus >= 300 && args.httpStatus < 400) {
    return 0.72;
  }
  if (args.httpStatus >= 400 && args.httpStatus < 500) {
    return 0.42;
  }
  return 0.33;
}

function buildUpsertSql(rows) {
  if (!rows.length) {
    return "select 0::int as upserted_rows, 0::int as updated_establishments;";
  }

  const values = rows
    .map((row) => {
      return `(${[
        sqlLiteral(row.establishment_id),
        sqlLiteral(row.source_url),
        `${sqlLiteral(row.fetched_at)}::timestamptz`,
        `${sqlLiteral(row.http_status)}::integer`,
        sqlLiteral(row.page_title),
        sqlLiteral(row.meta_description),
        sqlArray(row.headings),
        sqlArray(row.breadcrumbs),
        sqlArray(row.visible_categories),
        sqlArray(row.visible_brands),
        `${sqlLiteral(JSON.stringify(row.schema_entities ?? []))}::jsonb`,
        sqlLiteral(row.schema_opening_hours),
        sqlLiteral(row.extracted_opening_hours),
        sqlLiteral(row.extraction_notes),
        sqlLiteral(row.content_hash),
        `${sqlLiteral(row.freshness_score)}::numeric(5,4)`
      ].join(",")})`;
    })
    .join(",\n");

  return `
with incoming(
  establishment_id,
  source_url,
  fetched_at,
  http_status,
  page_title,
  meta_description,
  headings,
  breadcrumbs,
  visible_categories,
  visible_brands,
  schema_entities,
  schema_opening_hours,
  extracted_opening_hours,
  extraction_notes,
  content_hash,
  freshness_score
) as (
  values
  ${values}
),
upserted as (
  insert into establishment_website_enrichment (
    establishment_id,
    source_url,
    fetched_at,
    http_status,
    page_title,
    meta_description,
    headings,
    breadcrumbs,
    visible_categories,
    visible_brands,
    schema_entities,
    schema_opening_hours,
    extracted_opening_hours,
    extraction_notes,
    content_hash
  )
  select
    establishment_id,
    source_url,
    fetched_at,
    http_status,
    page_title,
    meta_description,
    headings,
    breadcrumbs,
    visible_categories,
    visible_brands,
    schema_entities,
    schema_opening_hours,
    extracted_opening_hours,
    extraction_notes,
    content_hash
  from incoming
  on conflict (establishment_id)
  do update set
    source_url = excluded.source_url,
    fetched_at = excluded.fetched_at,
    http_status = excluded.http_status,
    page_title = excluded.page_title,
    meta_description = excluded.meta_description,
    headings = excluded.headings,
    breadcrumbs = excluded.breadcrumbs,
    visible_categories = excluded.visible_categories,
    visible_brands = excluded.visible_brands,
    schema_entities = excluded.schema_entities,
    schema_opening_hours = excluded.schema_opening_hours,
    extracted_opening_hours = excluded.extracted_opening_hours,
    extraction_notes = excluded.extraction_notes,
    content_hash = excluded.content_hash,
    updated_at = now()
  returning establishment_id
),
updated as (
  update establishments e
  set
    source_url = coalesce(e.source_url, i.source_url),
    last_enriched_at = greatest(coalesce(e.last_enriched_at, i.fetched_at), i.fetched_at),
    last_seen_at = case
      when coalesce(i.http_status, 0) between 200 and 399
      then greatest(coalesce(e.last_seen_at, i.fetched_at), i.fetched_at)
      else e.last_seen_at
    end,
    opening_hours_website = coalesce(
      nullif(i.schema_opening_hours, ''),
      nullif(i.extracted_opening_hours, ''),
      e.opening_hours_website
    ),
    opening_hours = case
      when e.opening_hours_osm is not null and btrim(e.opening_hours_osm) <> '' then e.opening_hours_osm
      when i.schema_opening_hours is not null and btrim(i.schema_opening_hours) <> '' then i.schema_opening_hours
      when i.extracted_opening_hours is not null and btrim(i.extracted_opening_hours) <> '' then i.extracted_opening_hours
      else e.opening_hours
    end,
    opening_hours_source = case
      when e.opening_hours_osm is not null and btrim(e.opening_hours_osm) <> '' then 'osm'
      when i.schema_opening_hours is not null and btrim(i.schema_opening_hours) <> '' then 'schema_org'
      when i.extracted_opening_hours is not null and btrim(i.extracted_opening_hours) <> '' then 'website'
      else e.opening_hours_source
    end,
    opening_hours_source_url = case
      when e.opening_hours_osm is not null and btrim(e.opening_hours_osm) <> '' then coalesce(e.opening_hours_source_url, e.source_url)
      when i.schema_opening_hours is not null and btrim(i.schema_opening_hours) <> '' then i.source_url
      when i.extracted_opening_hours is not null and btrim(i.extracted_opening_hours) <> '' then i.source_url
      else e.opening_hours_source_url
    end,
    opening_hours_last_checked_at = i.fetched_at,
    opening_hours_confidence = case
      when e.opening_hours_osm is not null and btrim(e.opening_hours_osm) <> '' then 0.88
      when i.schema_opening_hours is not null and btrim(i.schema_opening_hours) <> '' then 0.79
      when i.extracted_opening_hours is not null and btrim(i.extracted_opening_hours) <> '' then 0.72
      else e.opening_hours_confidence
    end,
    opening_hours_conflict_note = case
      when e.opening_hours_osm is not null
        and btrim(e.opening_hours_osm) <> ''
        and i.schema_opening_hours is not null
        and btrim(i.schema_opening_hours) <> ''
        and lower(regexp_replace(e.opening_hours_osm, '\s+', '', 'g')) <>
            lower(regexp_replace(i.schema_opening_hours, '\s+', '', 'g'))
      then 'OSM and website schedule differ. OSM kept as primary.'
      when e.opening_hours_osm is not null
        and btrim(e.opening_hours_osm) <> ''
        and i.extracted_opening_hours is not null
        and btrim(i.extracted_opening_hours) <> ''
        and lower(regexp_replace(e.opening_hours_osm, '\s+', '', 'g')) <>
            lower(regexp_replace(i.extracted_opening_hours, '\s+', '', 'g'))
      then 'OSM and website schedule differ. OSM kept as primary.'
      else e.opening_hours_conflict_note
    end,
    freshness_score = compute_establishment_freshness_score(
      case
        when coalesce(i.http_status, 0) between 200 and 399
        then greatest(coalesce(e.last_seen_at, i.fetched_at), i.fetched_at)
        else e.last_seen_at
      end,
      e.last_imported_at,
      greatest(coalesce(e.last_enriched_at, i.fetched_at), i.fetched_at),
      e.is_closed_candidate,
      e.active_status
    ),
    updated_at = now()
  from incoming i
  where e.id = i.establishment_id
  returning e.id
)
select
  (select count(*)::int from upserted) as upserted_rows,
  (select count(*)::int from updated) as updated_establishments;
`;
}

async function fetchBatch(lastId, batchSize, staleDays) {
  const staleFilter = Number.isFinite(staleDays)
    ? `and (e.last_enriched_at is null or e.last_enriched_at < now() - interval '${Number(staleDays)} day')`
    : "";

  const sql = `
select
  e.id,
  e.name,
  e.website,
  e.last_enriched_at,
  e.freshness_score,
  w.content_hash as previous_content_hash
from establishments e
left join establishment_website_enrichment w on w.establishment_id = e.id
where e.external_source = 'osm-overpass'
  and e.active_status in ('active', 'temporarily_closed')
  and e.website is not null
  and btrim(e.website) <> ''
  and e.id > ${Number(lastId)}
  ${staleFilter}
order by e.id asc
limit ${Number(batchSize)};
`;

  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    website: String(row.website ?? ""),
    previous_content_hash: row.previous_content_hash ? String(row.previous_content_hash) : null,
    freshness_score: row.freshness_score == null ? null : Number(row.freshness_score)
  }));
}

async function fetchWebsiteSignals(url, timeoutMs) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": "KiezKaufBot/1.0 (+https://github.com/AxelSeara/kiez-kauf-berlin)"
    }
  });

  const html = await response.text();
  const contentHash = createHash("sha1").update(html).digest("hex");
  const title = extractTitle(html);
  const metaDescription = extractMetaDescription(html);
  const headings = extractHeadings(html);
  const entities = collectJsonLdEntities(html);
  const breadcrumbs = uniqueLimited([
    ...extractBreadcrumbsFromJsonLd(entities),
    ...extractBreadcrumbsFromHtml(html)
  ]);
  const visibleCategories = extractVisibleCategories(headings, breadcrumbs, title, metaDescription);
  const visibleBrands = extractBrands(entities, headings, title, metaDescription);
  const schemaOpeningHours = extractSchemaOpeningHours(entities);
  const extractedOpeningHours = extractOpeningHoursFromHtml(html);
  const extractionNotes = `Fetched in ${Date.now() - startedAt}ms`;

  return {
    http_status: response.status,
    page_title: title,
    meta_description: metaDescription,
    headings,
    breadcrumbs,
    visible_categories: visibleCategories,
    visible_brands: visibleBrands,
    schema_entities: entities,
    schema_opening_hours: schemaOpeningHours,
    extracted_opening_hours: extractedOpeningHours,
    extraction_notes: extractionNotes,
    content_hash: contentHash
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 25);
  const resume = Boolean(args.resume);
  const timeoutMs = Number(args["timeout-ms"] ?? DEFAULT_TIMEOUT_MS);
  const concurrency = Number(args.concurrency ?? 6);
  const maxEstablishments = args["max-establishments"] ? Number(args["max-establishments"]) : null;
  const staleDays = args["stale-days"] ? Number(args["stale-days"]) : Number.NaN;

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.enrichWebsites ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;

  let totalFetched = 0;
  let totalUpserted = 0;
  let totalUpdated = 0;

  logInfo("Website enrichment started", {
    batchSize,
    timeoutMs,
    concurrency,
    maxEstablishments,
    staleDays: Number.isFinite(staleDays) ? staleDays : null,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const establishments = await fetchBatch(cursor, batchSize, staleDays);
    if (!establishments.length) {
      break;
    }

    const rows = [];

    for (let start = 0; start < establishments.length; start += Math.max(1, concurrency)) {
      const block = establishments.slice(start, start + Math.max(1, concurrency));
      const settled = await Promise.allSettled(
        block.map(async (establishment) => {
          const normalizedUrl = normalizeWebsiteUrl(establishment.website);
          if (!normalizedUrl) {
            return null;
          }

          const fetchedAt = new Date().toISOString();
          const fallback = {
            establishment_id: establishment.id,
            source_url: normalizedUrl,
            fetched_at: fetchedAt,
            http_status: 0,
            page_title: null,
            meta_description: null,
            headings: [],
            breadcrumbs: [],
            visible_categories: [],
            visible_brands: [],
            schema_entities: [],
            schema_opening_hours: null,
            extracted_opening_hours: null,
            extraction_notes: "Website fetch failed",
            content_hash: null,
            freshness_score: 0.33
          };

          try {
            const signals = await fetchWebsiteSignals(normalizedUrl, timeoutMs);
            const changed = signals.content_hash !== establishment.previous_content_hash;
            const freshnessScore = Number(
              clamp(
                scoreFreshnessFromFetch({
                  httpStatus: signals.http_status,
                  contentHashChanged: changed
                }),
                0.05,
                0.99
              ).toFixed(4)
            );

            return {
              establishment_id: establishment.id,
              source_url: normalizedUrl,
              fetched_at: fetchedAt,
              ...signals,
              freshness_score: freshnessScore
            };
          } catch (error) {
            return {
              ...fallback,
              extraction_notes: `Website fetch failed: ${String(error).slice(0, 240)}`
            };
          }
        })
      );

      for (const item of settled) {
        if (item.status === "fulfilled" && item.value) {
          rows.push(item.value);
        }
      }
    }

    if (rows.length) {
      const sql = buildUpsertSql(rows);
      const result = await runSupabaseQuery({ sql, output: "json" });
      const upsertedRows = Number(result.parsed.rows?.[0]?.upserted_rows ?? 0);
      const updatedEstablishments = Number(result.parsed.rows?.[0]?.updated_establishments ?? 0);
      totalUpserted += upsertedRows;
      totalUpdated += updatedEstablishments;
    }

    totalFetched += establishments.length;
    cursor = establishments[establishments.length - 1].id;

    checkpoint.enrichWebsites = {
      lastId: cursor,
      totalFetched,
      totalUpserted,
      totalUpdated,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Website enrichment batch completed", {
      establishments: establishments.length,
      rowsPrepared: rows.length,
      cursor,
      totalFetched,
      totalUpserted,
      totalUpdated
    });

    if (maxEstablishments && totalFetched >= maxEstablishments) {
      logInfo("Stopping website enrichment due to max-establishments cap", {
        maxEstablishments,
        totalFetched
      });
      break;
    }
  }

  checkpoint.enrichWebsites = {
    lastId: cursor,
    totalFetched,
    totalUpserted,
    totalUpdated,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Website enrichment completed", {
    totalFetched,
    totalUpserted,
    totalUpdated
  });
}

main().catch((error) => {
  logWarn("Website enrichment failed", String(error));
  process.exit(1);
});
