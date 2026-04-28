create table if not exists public.ai_enrichment_runs (
  id bigserial primary key,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'stopped_budget')),
  district_scope text,
  model text not null,
  mode text not null check (mode in ('rules_plus_website', 'gpt_plus_website')),
  max_cost_usd_per_run numeric(12,6),
  max_cost_usd_per_day numeric(12,6),
  max_establishments integer,
  max_recommendations integer,
  require_website_signals boolean not null default false,
  only_ambiguous boolean not null default false,
  force_heuristic boolean not null default false,
  used_llm boolean not null default false,
  processed_establishments integer not null default 0,
  eligible_establishments integer not null default 0,
  ambiguous_establishments integer not null default 0,
  llm_attempted_establishments integer not null default 0,
  llm_used_establishments integer not null default 0,
  website_only_establishments integer not null default 0,
  heuristic_only_establishments integer not null default 0,
  website_extracted_candidates integer not null default 0,
  ai_generated_candidates integer not null default 0,
  rules_generated_candidates integer not null default 0,
  total_upsert_rows integer not null default 0,
  affected_rows integer not null default 0,
  errors_count integer not null default 0,
  tokens_input bigint not null default 0,
  tokens_output bigint not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  checkpoint_from_id bigint,
  checkpoint_to_id bigint,
  notes text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_enrichment_runs_started_at
  on public.ai_enrichment_runs(started_at desc);

create index if not exists idx_ai_enrichment_runs_status
  on public.ai_enrichment_runs(status, started_at desc);

create index if not exists idx_ai_enrichment_runs_district_scope
  on public.ai_enrichment_runs(district_scope, started_at desc);

create table if not exists public.ai_enrichment_run_items (
  id bigserial primary key,
  run_id bigint not null references public.ai_enrichment_runs(id) on delete cascade,
  establishment_id bigint references public.establishments(id) on delete set null,
  district text,
  eligible_for_llm boolean not null default false,
  is_ambiguous boolean not null default false,
  used_llm boolean not null default false,
  llm_skipped_reason text,
  prompt_hash text,
  product_pool_size integer not null default 0,
  website_candidates_count integer not null default 0,
  llm_candidates_count integer not null default 0,
  heuristic_candidates_count integer not null default 0,
  selected_candidates_count integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  unique (run_id, establishment_id)
);

create index if not exists idx_ai_enrichment_run_items_run_id
  on public.ai_enrichment_run_items(run_id);

create index if not exists idx_ai_enrichment_run_items_used_llm
  on public.ai_enrichment_run_items(run_id, used_llm);

create index if not exists idx_ai_enrichment_run_items_prompt_hash
  on public.ai_enrichment_run_items(prompt_hash);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at'
      and n.nspname = 'public'
  ) and not exists (
    select 1 from pg_trigger where tgname = 'trg_ai_enrichment_runs_set_updated_at'
  ) then
    create trigger trg_ai_enrichment_runs_set_updated_at
      before update on public.ai_enrichment_runs
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.ai_enrichment_runs enable row level security;
alter table public.ai_enrichment_run_items enable row level security;

revoke all on table public.ai_enrichment_runs from anon, authenticated;
revoke all on table public.ai_enrichment_run_items from anon, authenticated;

alter table if exists public.establishment_website_enrichment
  add column if not exists eligible_for_llm boolean not null default false;

update public.establishment_website_enrichment
set eligible_for_llm = (
  coalesce(http_status, 0) between 200 and 299
  and (
    coalesce(cardinality(headings), 0) >= 2
    or coalesce(cardinality(visible_categories), 0) >= 2
    or jsonb_array_length(coalesce(schema_entities, '[]'::jsonb)) >= 1
  )
);

create index if not exists idx_establishment_website_enrichment_eligible_for_llm
  on public.establishment_website_enrichment(eligible_for_llm, fetched_at desc);
