-- Lean v1 guardrails:
-- - reduce query latency for search dataset lookups
-- - reduce merge/candidate maintenance overhead
-- - keep storage growth under control with better indexing support

create extension if not exists pg_trgm with schema public;

create index if not exists idx_search_mv_product_name_trgm
  on public.search_product_establishment_mv
  using gin (product_normalized_name gin_trgm_ops);

create index if not exists idx_search_mv_canonical_product
  on public.search_product_establishment_mv(canonical_product_id);

create index if not exists idx_search_mv_product_group_confidence
  on public.search_product_establishment_mv(product_group, confidence desc, updated_at desc);

create index if not exists idx_search_mv_geo_confidence
  on public.search_product_establishment_mv(lat, lon, confidence desc, updated_at desc);

create index if not exists idx_epc_establishment_confidence_active
  on public.establishment_product_candidates(establishment_id, confidence desc, canonical_product_id)
  where validation_status <> 'rejected';

create index if not exists idx_epm_establishment_confidence_active
  on public.establishment_product_merged(establishment_id, confidence desc, canonical_product_id)
  where validation_status <> 'rejected';
