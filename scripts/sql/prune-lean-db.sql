-- Lean pruning for production serving footprint.
-- Keeps core catalog/establishments/merged serving data.
-- Removes regenerable pipeline/audit bulk.

-- 1) Prevent new unbounded audit growth from generated rows.
create or replace function public.audit_establishment_product_candidate_changes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_type text := coalesce(nullif(current_setting('app.audit.actor_type', true), ''), 'system');
  actor_id text := nullif(current_setting('app.audit.actor_id', true), '');
  actor_reason text := nullif(current_setting('app.audit.reason', true), '');
  target_source_type text := coalesce(
    case when tg_op = 'DELETE' then old.source_type::text else new.source_type::text end,
    ''
  );
  target_validation_status text := coalesce(
    case when tg_op = 'DELETE' then old.validation_status::text else new.validation_status::text end,
    ''
  );
  should_audit boolean := false;
begin
  -- Only keep audit traces for high-value/manual/terminal records.
  should_audit := (
    target_source_type in ('merchant_added', 'user_validated', 'validated')
    or target_validation_status in ('validated', 'rejected')
  );

  -- Also keep update traces when row transitions into/out of terminal states.
  if tg_op = 'UPDATE' then
    should_audit := should_audit
      or old.validation_status::text in ('validated', 'rejected')
      or new.validation_status::text in ('validated', 'rejected');
  end if;

  if not should_audit then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into establishment_product_candidate_audit (
      candidate_id, action, changed_by_type, changed_by_id, reason, new_row
    )
    values (
      new.id, 'insert', actor_type, actor_id, actor_reason, to_jsonb(new)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into establishment_product_candidate_audit (
      candidate_id, action, changed_by_type, changed_by_id, reason, old_row, new_row
    )
    values (
      new.id, 'update', actor_type, actor_id, actor_reason, to_jsonb(old), to_jsonb(new)
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into establishment_product_candidate_audit (
      candidate_id, action, changed_by_type, changed_by_id, reason, old_row
    )
    values (
      old.id, 'delete', actor_type, actor_id, actor_reason, to_jsonb(old)
    );
    return old;
  end if;

  return null;
end;
$$;

-- 2) Hard prune fully regenerable operational tables.
truncate table public.establishment_product_candidate_audit restart identity;
truncate table public.berlin_establishment_stage restart identity;
truncate table public.establishment_website_enrichment restart identity;

-- 3) Remove generated non-terminal candidate bulk.
delete from public.establishment_product_candidates
where validation_status not in ('validated', 'rejected')
  and source_type in ('rules_generated', 'ai_generated', 'website_extracted', 'imported');

-- 4) Remove rejected auto-merged rows from serving layer.
delete from public.establishment_product_merged
where validation_status = 'rejected'
  and primary_source_type = 'rules_generated';

-- 5) Refresh serving materialized view.
select public.refresh_search_product_establishment_mv();
