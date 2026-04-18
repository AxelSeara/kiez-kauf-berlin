-- Security + storage hotfix for production Supabase project.
-- Goals:
-- 1) Remove broad anon/authenticated write surface.
-- 2) Enable RLS across publicly exposed tables.
-- 3) Keep app reads/inserts working through minimal policies.
-- 4) Fix advisor warnings for mutable search_path and security definer view.
-- 5) Add a reusable audit pruning function to control table growth.

begin;

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  search_term text not null,
  category text,
  district text,
  radius_km numeric,
  results_count integer,
  has_results boolean,
  endpoint text,
  "timestamp" timestamptz not null default now()
);

create index if not exists idx_searches_timestamp_desc
  on public.searches("timestamp" desc);

create index if not exists idx_searches_has_results
  on public.searches(has_results, "timestamp" desc);

create index if not exists idx_searches_search_term
  on public.searches(search_term);

-- ---------------------------------------------------------------------------
-- Privileges: remove broad grants for anon/authenticated from public tables.
-- ---------------------------------------------------------------------------

revoke all on table public.stores from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.offers from anon, authenticated;
revoke all on table public.route_clicks from anon, authenticated;
revoke all on table public.establishments from anon, authenticated;
revoke all on table public.canonical_products from anon, authenticated;
revoke all on table public.establishment_product_candidates from anon, authenticated;
revoke all on table public.establishment_product_candidate_audit from anon, authenticated;
revoke all on table public.app_category_taxonomy from anon, authenticated;
revoke all on table public.establishment_product_merged from anon, authenticated;
revoke all on table public.berlin_establishment_stage from anon, authenticated;
revoke all on table public.establishment_website_enrichment from anon, authenticated;
revoke all on table public.establishment_refresh_runs from anon, authenticated;
revoke all on table public.searches from anon, authenticated;

-- Keep read-only access where the web app needs it.
grant select on table public.stores to anon, authenticated;
grant select on table public.products to anon, authenticated;
grant select on table public.offers to anon, authenticated;
grant select on table public.establishments to anon, authenticated;
grant select on table public.canonical_products to anon, authenticated;

grant select on table public.search_product_establishment_mv to anon, authenticated;
grant select on table public.search_product_establishment_dataset to anon, authenticated;

-- Keep anonymous analytics writes only where expected.
grant insert on table public.route_clicks to anon, authenticated;
grant usage, select on sequence public.route_clicks_id_seq to anon, authenticated;
grant insert on table public.searches to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: enable row-level security on all public-facing tables.
-- ---------------------------------------------------------------------------

alter table if exists public.stores enable row level security;
alter table if exists public.products enable row level security;
alter table if exists public.offers enable row level security;
alter table if exists public.route_clicks enable row level security;
alter table if exists public.establishments enable row level security;
alter table if exists public.canonical_products enable row level security;
alter table if exists public.establishment_product_candidates enable row level security;
alter table if exists public.establishment_product_candidate_audit enable row level security;
alter table if exists public.app_category_taxonomy enable row level security;
alter table if exists public.establishment_product_merged enable row level security;
alter table if exists public.berlin_establishment_stage enable row level security;
alter table if exists public.establishment_website_enrichment enable row level security;
alter table if exists public.establishment_refresh_runs enable row level security;
alter table if exists public.searches enable row level security;

-- ---------------------------------------------------------------------------
-- RLS policies: explicit minimum access.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stores' and policyname = 'public_read_stores'
  ) then
    create policy public_read_stores
      on public.stores
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'products' and policyname = 'public_read_products'
  ) then
    create policy public_read_products
      on public.products
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'offers' and policyname = 'public_read_offers'
  ) then
    create policy public_read_offers
      on public.offers
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'establishments' and policyname = 'public_read_establishments'
  ) then
    create policy public_read_establishments
      on public.establishments
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'canonical_products' and policyname = 'public_read_canonical_products'
  ) then
    create policy public_read_canonical_products
      on public.canonical_products
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'route_clicks' and policyname = 'public_insert_route_clicks'
  ) then
    drop policy public_insert_route_clicks on public.route_clicks;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'route_clicks' and policyname = 'public_insert_route_clicks'
  ) then
    create policy public_insert_route_clicks
      on public.route_clicks
      for insert
      to anon, authenticated
      with check (
        char_length(btrim(interaction_id)) between 8 and 200
        and char_length(btrim(store_id)) > 0
        and char_length(btrim(product_id)) > 0
        and (origin_lat is null or origin_lat between -90 and 90)
        and (origin_lng is null or origin_lng between -180 and 180)
        and (destination_lat is null or destination_lat between -90 and 90)
        and (destination_lng is null or destination_lng between -180 and 180)
        and locale in ('en', 'de', 'es')
      );
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'searches' and policyname = 'public_insert_searches'
  ) then
    drop policy public_insert_searches on public.searches;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'searches' and policyname = 'public_insert_searches'
  ) then
    create policy public_insert_searches
      on public.searches
      for insert
      to anon, authenticated
      with check (
        char_length(btrim(search_term)) between 1 and 160
        and (category is null or char_length(btrim(category)) <= 80)
        and (district is null or char_length(btrim(district)) <= 80)
        and (radius_km is null or (radius_km >= 0 and radius_km <= 50))
        and (results_count is null or (results_count >= -1 and results_count <= 5000))
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Advisor fixes: functions + view.
-- ---------------------------------------------------------------------------

alter function public.set_updated_at_timestamp()
  set search_path = public;

alter function public.audit_establishment_product_candidate_changes()
  set search_path = public;

alter function public.refresh_establishment_freshness_scores()
  set search_path = public;

alter function public.refresh_search_product_establishment_mv()
  set search_path = public;

alter function public.compute_establishment_freshness_score(
  p_last_seen_at timestamp with time zone,
  p_last_imported_at timestamp with time zone,
  p_last_enriched_at timestamp with time zone,
  p_is_closed_candidate boolean,
  p_active_status active_status_enum
)
  set search_path = public;

alter view if exists public.search_product_establishment_dataset
  set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Storage control: reusable audit pruning helper.
-- Keeps at least N latest records per candidate and preserves validation events.
-- ---------------------------------------------------------------------------

create or replace function public.prune_establishment_product_candidate_audit(
  p_keep_latest_per_candidate integer default 1
)
returns table(deleted_rows bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with ranked as (
    select
      id,
      candidate_id,
      row_number() over (
        partition by candidate_id
        order by changed_at desc, id desc
      ) as rn,
      coalesce(new_row->>'validation_status', old_row->>'validation_status') as validation_status
    from public.establishment_product_candidate_audit
  ),
  to_delete as (
    select id
    from ranked
    where rn > greatest(p_keep_latest_per_candidate, 1)
      and coalesce(validation_status, '') not in ('validated', 'rejected')
  ),
  deleted as (
    delete from public.establishment_product_candidate_audit a
    using to_delete d
    where a.id = d.id
    returning 1
  )
  select count(*)::bigint as deleted_rows
  from deleted;
end;
$$;

commit;
