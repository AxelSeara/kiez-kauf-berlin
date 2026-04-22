begin;

-- Lean V2: keep serving layer compact and remove low-value index overhead.

-- Serving dataset should not keep rejected rows. Rejections remain in candidates.
delete from public.establishment_product_merged
where validation_status = 'rejected';

-- Drop indexes with persistent zero-scan usage in production audit.
drop index if exists public.idx_search_product_establishment_mv_freshness;
drop index if exists public.idx_search_product_establishment_mv_candidate_freshness;
drop index if exists public.idx_epc_source_url;
drop index if exists public.idx_epm_last_checked_at;

commit;
