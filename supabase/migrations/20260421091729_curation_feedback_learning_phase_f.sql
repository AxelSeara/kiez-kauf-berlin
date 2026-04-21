begin;

-- ---------------------------------------------------------------------------
-- Phase F: curation feedback loop + conservative rule learning
-- ---------------------------------------------------------------------------

create table if not exists public.app_category_group_rules (
  id bigserial primary key,
  app_category text not null,
  product_group text not null,
  base_confidence numeric(5,4) not null check (base_confidence >= 0 and base_confidence <= 1),
  reason text not null,
  source text not null default 'seed' check (source in ('seed', 'curation', 'manual')),
  support_count integer,
  precision_score numeric(6,4),
  auto_apply_eligible boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_category_group_rules_unique unique (app_category, product_group),
  constraint app_category_group_rules_app_category_normalized_chk check (app_category = lower(btrim(app_category))),
  constraint app_category_group_rules_product_group_normalized_chk check (product_group = lower(btrim(product_group))),
  constraint app_category_group_rules_support_non_negative_chk check (support_count is null or support_count >= 0),
  constraint app_category_group_rules_precision_range_chk check (
    precision_score is null or (precision_score >= 0 and precision_score <= 1)
  )
);

create index if not exists idx_app_category_group_rules_active
  on public.app_category_group_rules(is_active, app_category, product_group);

create index if not exists idx_app_category_group_rules_auto_apply
  on public.app_category_group_rules(auto_apply_eligible, support_count desc nulls last, precision_score desc nulls last)
  where is_active = true;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_app_category_group_rules_set_updated_at'
  ) then
    create trigger trg_app_category_group_rules_set_updated_at
      before update on public.app_category_group_rules
      for each row execute function public.set_updated_at_timestamp();
  end if;
end
$$;

insert into public.app_category_group_rules (
  app_category,
  product_group,
  base_confidence,
  reason,
  source,
  is_active
)
values
  ('grocery', 'groceries', 0.82, 'grocery stores usually stock pantry essentials', 'seed', true),
  ('grocery', 'beverages', 0.79, 'grocery stores typically include beverage aisles', 'seed', true),
  ('grocery', 'fresh_produce', 0.76, 'grocery stores often include produce', 'seed', true),
  ('grocery', 'household', 0.71, 'grocery stores often carry household basics', 'seed', true),
  ('grocery', 'pet_care', 0.74, 'many grocery stores carry basic pet food and pet care', 'seed', true),
  ('convenience', 'beverages', 0.80, 'convenience stores focus on ready-to-buy drinks', 'seed', true),
  ('convenience', 'snacks', 0.78, 'convenience stores are snack-heavy', 'seed', true),
  ('convenience', 'groceries', 0.65, 'convenience stores carry a compact grocery set', 'seed', true),
  ('fresh-food', 'fresh_produce', 0.84, 'fresh food stores strongly map to produce', 'seed', true),
  ('fresh-food', 'groceries', 0.69, 'fresh food stores may carry pantry complement products', 'seed', true),
  ('bakery', 'bakery', 0.90, 'bakery category directly maps to bakery items', 'seed', true),
  ('bakery', 'beverages', 0.63, 'bakeries often sell coffee and drinks', 'seed', true),
  ('butcher', 'meat', 0.92, 'butcher category directly maps to meat products', 'seed', true),
  ('butcher', 'groceries', 0.57, 'butchers may carry supporting groceries', 'seed', true),
  ('produce', 'fresh_produce', 0.91, 'produce category maps to fruits and vegetables', 'seed', true),
  ('drinks', 'beverages', 0.92, 'drink stores map to beverage products', 'seed', true),
  ('pharmacy', 'pharmacy', 0.93, 'pharmacies map to medicine products', 'seed', true),
  ('pharmacy', 'personal_care', 0.82, 'pharmacies stock personal care products', 'seed', true),
  ('personal-care', 'personal_care', 0.86, 'personal care category maps directly', 'seed', true),
  ('medical-supplies', 'pharmacy', 0.93, 'medical supply stores map to pharmacy essentials', 'seed', true),
  ('medical-supplies', 'personal_care', 0.72, 'medical supply stores may include care products', 'seed', true),
  ('household', 'household', 0.88, 'household category maps directly', 'seed', true),
  ('hardware', 'household', 0.93, 'hardware stores map to repair and household products', 'seed', true),
  ('bio', 'groceries', 0.74, 'organic stores stock core groceries', 'seed', true),
  ('bio', 'fresh_produce', 0.77, 'organic stores stock produce', 'seed', true),
  ('bio', 'beverages', 0.70, 'organic stores stock beverages', 'seed', true)
on conflict (app_category, product_group) do nothing;

create table if not exists public.curation_events (
  id bigserial primary key,
  event_type text not null check (
    event_type in (
      'establishment_update',
      'category_set',
      'product_add',
      'product_validate',
      'product_reject',
      'product_remove',
      'alias_add',
      'rule_suggest',
      'rule_apply'
    )
  ),
  entity_type text not null check (entity_type in ('establishment', 'establishment_product', 'alias', 'rule')),
  establishment_id bigint references public.establishments(id) on delete set null,
  canonical_product_id bigint references public.canonical_products(id) on delete set null,
  app_category text,
  product_group text,
  reason text,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  actor_type text not null default 'admin',
  actor_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_curation_events_created_at
  on public.curation_events(created_at desc);

create index if not exists idx_curation_events_establishment
  on public.curation_events(establishment_id, created_at desc);

create index if not exists idx_curation_events_product
  on public.curation_events(canonical_product_id, created_at desc);

create index if not exists idx_curation_events_event_type
  on public.curation_events(event_type, created_at desc);

create index if not exists idx_curation_events_group_category
  on public.curation_events(app_category, product_group, created_at desc);

create table if not exists public.curation_rule_suggestions (
  id bigserial primary key,
  app_category text not null,
  product_group text not null,
  window_days integer not null default 90 check (window_days between 7 and 365),
  support_count integer not null default 0 check (support_count >= 0),
  positive_count integer not null default 0 check (positive_count >= 0),
  precision_score numeric(6,4) not null default 0 check (precision_score >= 0 and precision_score <= 1),
  auto_apply_eligible boolean not null default false,
  status text not null default 'suggested' check (status in ('suggested', 'applied', 'discarded')),
  notes text,
  generated_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint curation_rule_suggestions_unique unique (app_category, product_group, window_days),
  constraint curation_rule_suggestions_app_category_normalized_chk check (app_category = lower(btrim(app_category))),
  constraint curation_rule_suggestions_product_group_normalized_chk check (product_group = lower(btrim(product_group))),
  constraint curation_rule_suggestions_positive_lte_support_chk check (positive_count <= support_count)
);

create index if not exists idx_curation_rule_suggestions_status
  on public.curation_rule_suggestions(status, auto_apply_eligible, precision_score desc, support_count desc);

create index if not exists idx_curation_rule_suggestions_generated
  on public.curation_rule_suggestions(generated_at desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_curation_rule_suggestions_set_updated_at'
  ) then
    create trigger trg_curation_rule_suggestions_set_updated_at
      before update on public.curation_rule_suggestions
      for each row execute function public.set_updated_at_timestamp();
  end if;
end
$$;

alter table public.app_category_group_rules enable row level security;
alter table public.curation_events enable row level security;
alter table public.curation_rule_suggestions enable row level security;

commit;
