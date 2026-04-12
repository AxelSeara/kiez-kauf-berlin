-- GPT + website enrichment traceability for Berlin dataset quality improvements.

do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumtypid = 'source_type_enum'::regtype
      and enumlabel = 'website_extracted'
  ) then
    alter type source_type_enum add value 'website_extracted';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumtypid = 'source_type_enum'::regtype
      and enumlabel = 'validated'
  ) then
    alter type source_type_enum add value 'validated';
  end if;
end $$;

alter table if exists establishment_product_candidates
  add column if not exists source_url text,
  add column if not exists extraction_method text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists freshness_score numeric(5,4);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'establishment_product_candidates_freshness_score_check'
  ) then
    alter table establishment_product_candidates
      add constraint establishment_product_candidates_freshness_score_check
      check (freshness_score is null or (freshness_score >= 0 and freshness_score <= 1));
  end if;
end $$;

create index if not exists idx_epc_last_checked_at
  on establishment_product_candidates(last_checked_at desc);

create index if not exists idx_epc_extraction_method
  on establishment_product_candidates(extraction_method);

create index if not exists idx_epc_source_url
  on establishment_product_candidates(source_url);

alter table if exists establishment_product_merged
  add column if not exists source_url text,
  add column if not exists extraction_method text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists freshness_score numeric(5,4);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'establishment_product_merged_freshness_score_check'
  ) then
    alter table establishment_product_merged
      add constraint establishment_product_merged_freshness_score_check
      check (freshness_score is null or (freshness_score >= 0 and freshness_score <= 1));
  end if;
end $$;

create index if not exists idx_epm_last_checked_at
  on establishment_product_merged(last_checked_at desc);

create index if not exists idx_epm_extraction_method
  on establishment_product_merged(extraction_method);

with ranked as (
  select distinct on (c.establishment_id, c.canonical_product_id)
    c.establishment_id,
    c.canonical_product_id,
    c.source_url,
    c.extraction_method,
    c.last_checked_at,
    c.freshness_score
  from establishment_product_candidates c
  order by
    c.establishment_id,
    c.canonical_product_id,
    c.confidence desc nulls last,
    c.updated_at desc,
    c.id asc
)
update establishment_product_merged m
set
  source_url = coalesce(m.source_url, r.source_url),
  extraction_method = coalesce(m.extraction_method, r.extraction_method),
  last_checked_at = coalesce(m.last_checked_at, r.last_checked_at),
  freshness_score = coalesce(
    m.freshness_score,
    r.freshness_score,
    e.freshness_score
  )
from ranked r
join establishments e on e.id = r.establishment_id
where m.establishment_id = r.establishment_id
  and m.canonical_product_id = r.canonical_product_id;

drop view if exists search_product_establishment_dataset;
drop materialized view if exists search_product_establishment_mv;

create materialized view search_product_establishment_mv as
with ranked as (
  select
    m.establishment_id,
    m.canonical_product_id,
    m.primary_source_type as source_type,
    m.confidence,
    m.validation_status,
    m.why_this_product_matches,
    m.category_path,
    m.inferred_from,
    m.source_url as candidate_source_url,
    m.extraction_method as candidate_extraction_method,
    m.last_checked_at as candidate_last_checked_at,
    m.freshness_score as candidate_freshness_score,
    m.updated_at,
    e.external_source,
    e.external_id,
    e.name as establishment_name,
    e.address,
    e.district,
    e.lat,
    e.lon,
    e.osm_category,
    e.app_categories,
    e.opening_hours,
    e.opening_hours_source,
    e.opening_hours_confidence,
    e.freshness_score,
    e.last_seen_at,
    e.last_imported_at,
    e.last_enriched_at,
    e.source_url,
    p.normalized_name as product_normalized_name,
    p.display_name_es,
    p.display_name_en,
    p.display_name_de,
    p.product_group,
    row_number() over (
      partition by m.establishment_id, m.canonical_product_id
      order by m.confidence desc, m.updated_at desc, m.id asc
    ) as rn
  from establishment_product_merged m
  join establishments e on e.id = m.establishment_id
  join canonical_products p on p.id = m.canonical_product_id
  where m.validation_status <> 'rejected'
    and e.active_status in ('active', 'temporarily_closed')
    and coalesce(e.is_closed_candidate, false) = false
    and e.possible_duplicate_of is null
)
select
  establishment_id,
  canonical_product_id,
  source_type,
  confidence,
  validation_status,
  why_this_product_matches,
  category_path,
  inferred_from,
  candidate_source_url,
  candidate_extraction_method,
  candidate_last_checked_at,
  candidate_freshness_score,
  updated_at,
  external_source,
  external_id,
  establishment_name,
  address,
  district,
  lat,
  lon,
  osm_category,
  app_categories,
  opening_hours,
  opening_hours_source,
  opening_hours_confidence,
  freshness_score,
  last_seen_at,
  last_imported_at,
  last_enriched_at,
  source_url,
  product_normalized_name,
  display_name_es,
  display_name_en,
  display_name_de,
  product_group
from ranked
where rn = 1;

create unique index if not exists idx_search_product_establishment_mv_unique
  on search_product_establishment_mv(establishment_id, canonical_product_id);

create index if not exists idx_search_product_establishment_mv_product_name
  on search_product_establishment_mv(product_normalized_name);

create index if not exists idx_search_product_establishment_mv_validation
  on search_product_establishment_mv(validation_status);

create index if not exists idx_search_product_establishment_mv_district
  on search_product_establishment_mv(district);

create index if not exists idx_search_product_establishment_mv_lat_lon
  on search_product_establishment_mv(lat, lon);

create index if not exists idx_search_product_establishment_mv_freshness
  on search_product_establishment_mv(freshness_score desc);

create index if not exists idx_search_product_establishment_mv_candidate_freshness
  on search_product_establishment_mv(candidate_freshness_score desc);

create or replace view search_product_establishment_dataset as
select * from search_product_establishment_mv;

create or replace function refresh_search_product_establishment_mv()
returns void
language plpgsql
as $$
begin
  refresh materialized view search_product_establishment_mv;
end;
$$;
