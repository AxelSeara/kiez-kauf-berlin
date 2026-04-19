begin;

-- Phase E: remove residual serving dependency on legacy canonical fields,
-- keep response compatibility, and open read access to child catalog tables.

-- ---------------------------------------------------------------------------
-- Public read access for catalog child tables (required by anon search runtime).
-- ---------------------------------------------------------------------------

grant select on table public.canonical_product_aliases to anon, authenticated;
grant select on table public.canonical_product_facets to anon, authenticated;
grant select on table public.canonical_product_use_cases to anon, authenticated;

alter table if exists public.canonical_product_aliases enable row level security;
alter table if exists public.canonical_product_facets enable row level security;
alter table if exists public.canonical_product_use_cases enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'canonical_product_aliases'
      and policyname = 'public_read_canonical_product_aliases'
  ) then
    create policy public_read_canonical_product_aliases
      on public.canonical_product_aliases
      for select
      to anon, authenticated
      using (coalesce(is_active, true));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'canonical_product_facets'
      and policyname = 'public_read_canonical_product_facets'
  ) then
    create policy public_read_canonical_product_facets
      on public.canonical_product_facets
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'canonical_product_use_cases'
      and policyname = 'public_read_canonical_product_use_cases'
  ) then
    create policy public_read_canonical_product_use_cases
      on public.canonical_product_use_cases
      for select
      to anon, authenticated
      using (coalesce(is_active, true));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Refresh serving view: use group_key as primary source for product_group.
-- Keep output shape backward compatible.
-- ---------------------------------------------------------------------------

drop view if exists public.search_product_establishment_dataset;
drop materialized view if exists public.search_product_establishment_mv;

create materialized view public.search_product_establishment_mv as
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
    coalesce(p.group_key, p.product_group) as product_group,
    p.family_slug as product_family_slug,
    row_number() over (
      partition by m.establishment_id, m.canonical_product_id
      order by m.confidence desc, m.updated_at desc, m.id asc
    ) as rn
  from public.establishment_product_merged m
  join public.establishments e on e.id = m.establishment_id
  join public.canonical_products p on p.id = m.canonical_product_id
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
  product_group,
  product_family_slug
from ranked
where rn = 1;

create unique index if not exists idx_search_product_establishment_mv_unique
  on public.search_product_establishment_mv(establishment_id, canonical_product_id);

create index if not exists idx_search_product_establishment_mv_product_name
  on public.search_product_establishment_mv(product_normalized_name);

create index if not exists idx_search_product_establishment_mv_validation
  on public.search_product_establishment_mv(validation_status);

create index if not exists idx_search_product_establishment_mv_district
  on public.search_product_establishment_mv(district);

create index if not exists idx_search_product_establishment_mv_lat_lon
  on public.search_product_establishment_mv(lat, lon);

create index if not exists idx_search_product_establishment_mv_freshness
  on public.search_product_establishment_mv(freshness_score desc);

create index if not exists idx_search_product_establishment_mv_candidate_freshness
  on public.search_product_establishment_mv(candidate_freshness_score desc);

create index if not exists idx_search_mv_product_name_trgm
  on public.search_product_establishment_mv
  using gin (product_normalized_name gin_trgm_ops);

create index if not exists idx_search_mv_canonical_product
  on public.search_product_establishment_mv(canonical_product_id);

create index if not exists idx_search_mv_product_group_confidence
  on public.search_product_establishment_mv(product_group, confidence desc, updated_at desc);

create index if not exists idx_search_mv_geo_confidence
  on public.search_product_establishment_mv(lat, lon, confidence desc, updated_at desc);

create or replace view public.search_product_establishment_dataset
with (security_invoker = true)
as
select * from public.search_product_establishment_mv;

create or replace function public.refresh_search_product_establishment_mv()
returns void
language plpgsql
as $$
begin
  refresh materialized view public.search_product_establishment_mv;
end;
$$;

alter function public.refresh_search_product_establishment_mv()
  set search_path = public;

commit;
