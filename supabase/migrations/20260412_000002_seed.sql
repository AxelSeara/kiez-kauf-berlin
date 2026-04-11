insert into stores (id, name, address, district, opening_hours, lat, lng) values
  ('st_1', 'Kiez Markt Kreuzberg', 'Oranienstrasse 164, 10969 Berlin', 'Kreuzberg', 'Mo-Sa 08:00-22:00', 52.5006, 13.4034),
  ('st_2', 'Bio Eck Prenzlauer Berg', 'Schoenhauser Allee 142, 10437 Berlin', 'Prenzlauer Berg', 'Mo-Sa 09:00-21:00', 52.5406, 13.4123),
  ('st_3', 'Friedrichshain Kiosk Plus', 'Warschauer Strasse 37, 10243 Berlin', 'Friedrichshain', 'Mo-So 10:00-23:00', 52.5051, 13.4476)
on conflict (id) do nothing;

insert into products (id, normalized_name, brand, category) values
  ('pr_1', 'hafermilch 1l', 'Oatly', 'getraenke'),
  ('pr_2', 'pasta fusilli 500g', 'Barilla', 'lebensmittel'),
  ('pr_3', 'zahnpasta sensitive', 'Elmex', 'drogerie')
on conflict (id) do nothing;

insert into offers (id, store_id, product_id, price_optional, availability, updated_at) values
  ('of_1', 'st_1', 'pr_1', 2.49, 'in_stock', now() - interval '3 hours'),
  ('of_2', 'st_2', 'pr_1', 2.29, 'low_stock', now() - interval '6 hours'),
  ('of_3', 'st_3', 'pr_2', 1.99, 'in_stock', now() - interval '24 hours'),
  ('of_4', 'st_1', 'pr_3', null, 'in_stock', now() - interval '30 hours')
on conflict (id) do nothing;

-- ============================================================
-- Minimal Berlin seed for establishments + canonical products + auditable candidates
-- Establishments are real OSM entities from data/moabit/stores.csv
-- ============================================================

insert into establishments (
  external_source, external_id, name, address, district, lat, lon,
  osm_category, app_categories, website, phone, opening_hours, description, active_status
) values
  (
    'osm-overpass', 'node/667451730', 'Abu Laila', 'Beusselstrasse 69, 10553, Berlin', 'Moabit',
    52.528676, 13.328418, 'bakery', '{food,bakery}', null, null, '09:00-23:00',
    'OSM place in Berlin (Moabit).', 'active'
  ),
  (
    'osm-overpass', 'node/2882043823', 'Adler Getraenke und Kiosk', 'Wiclefstrasse 50, 10551, Berlin', 'Moabit',
    52.530383, 13.333910, 'beverages', '{drinks,kiosk,convenience}', null, null, null,
    'OSM place in Berlin (Moabit).', 'active'
  ),
  (
    'osm-overpass', 'node/4381394723', 'Afro Asia', 'Torfstrasse 24, Berlin', 'Moabit',
    52.540745, 13.350994, 'convenience', '{convenience,grocery}', null, null, 'Mo-Sa 09:00-20:00',
    'OSM place in Berlin (Moabit).', 'active'
  ),
  (
    'osm-overpass', 'way/142947685', 'Aldi', 'Invalidenstrasse 59, 10557, Berlin', 'Moabit',
    52.524181, 13.364082, 'supermarket', '{grocery,discount,household}', null, null, 'Mo-Sa 07:00-22:00',
    'OSM place in Berlin (Moabit).', 'active'
  ),
  (
    'osm-overpass', 'node/4761858224', 'Alnatura Super Natur Markt', 'Berlin', 'Moabit',
    52.526766, 13.332649, 'supermarket', '{grocery,bio,household}', null, null, 'Mo-Sa 08:00-21:00; PH off',
    'OSM place in Berlin (Moabit).', 'active'
  ),
  (
    'osm-overpass', 'node/250195921', 'Alte Roland-Apotheke', 'Turmstrasse 15, 10559, Berlin', 'Moabit',
    52.526463, 13.350122, 'pharmacy', '{pharmacy,health,personal_care}', null, null, 'Mo-Fr 09:00-18:30; Sa 09:00-13:00',
    'OSM place in Berlin (Moabit).', 'active'
  ),
  (
    'osm-overpass', 'node/8208959404', 'Am Park', 'Ottostrasse 9, 10555, Berlin', 'Moabit',
    52.525630, 13.334893, 'kiosk', '{kiosk,convenience,drinks}', null, null, null,
    'OSM place in Berlin (Moabit).', 'active'
  ),
  (
    'osm-overpass', 'node/3121381082', 'Ayoub', 'Berlin', 'Moabit',
    52.527820, 13.326313, 'butcher', '{butcher,fresh_food}', null, null, null,
    'OSM place in Berlin (Moabit).', 'active'
  )
on conflict (external_source, external_id) do update
set
  name = excluded.name,
  address = excluded.address,
  district = excluded.district,
  lat = excluded.lat,
  lon = excluded.lon,
  osm_category = excluded.osm_category,
  app_categories = excluded.app_categories,
  website = excluded.website,
  phone = excluded.phone,
  opening_hours = excluded.opening_hours,
  description = excluded.description,
  active_status = excluded.active_status,
  updated_at = now();

insert into canonical_products (
  normalized_name, display_name_es, display_name_en, display_name_de, synonyms, product_group
) values
  ('hafermilch 1l', 'Leche de avena 1L', 'Oat milk 1L', 'Hafermilch 1L', '{oat milk,hafermilch,hafer drink}', 'beverages'),
  ('vollmilch 1l', 'Leche entera 1L', 'Whole milk 1L', 'Vollmilch 1L', '{whole milk,vollmilch,milk 1l}', 'beverages'),
  ('eier 10 stueck', 'Huevos 10 unidades', 'Eggs pack of 10', 'Eier 10 Stueck', '{eggs 10,eier 10,egg pack}', 'groceries'),
  ('brot weizen', 'Pan de trigo', 'Wheat bread', 'Weizenbrot', '{wheat bread,brot,broetchen}', 'groceries'),
  ('reis basmati 1kg', 'Arroz basmati 1kg', 'Basmati rice 1kg', 'Basmati-Reis 1kg', '{basmati rice,reis 1kg}', 'groceries'),
  ('pasta fusilli 500g', 'Pasta fusilli 500g', 'Fusilli pasta 500g', 'Fusilli Nudeln 500g', '{fusilli,pasta 500g,nudeln}', 'groceries'),
  ('tomatensauce 500g', 'Salsa de tomate 500g', 'Tomato sauce 500g', 'Tomatensauce 500g', '{tomato sauce,salsa tomate}', 'groceries'),
  ('olivenoel 1l', 'Aceite de oliva 1L', 'Olive oil 1L', 'Olivenoel 1L', '{olive oil,aceite oliva}', 'groceries'),
  ('aepfel 1kg', 'Manzanas 1kg', 'Apples 1kg', 'Aepfel 1kg', '{apples,manzanas,aepfel}', 'fresh_produce'),
  ('bananen 1kg', 'Bananas 1kg', 'Bananas 1kg', 'Bananen 1kg', '{bananas,bananen}', 'fresh_produce'),
  ('zahnpasta sensitive', 'Pasta dental sensitive', 'Sensitive toothpaste', 'Zahnpasta Sensitive', '{toothpaste,zahnpasta}', 'personal_care'),
  ('shampoo 300ml', 'Champu 300ml', 'Shampoo 300ml', 'Shampoo 300ml', '{shampoo,champu}', 'personal_care'),
  ('toilettenpapier 8 rollen', 'Papel higienico 8 rollos', 'Toilet paper 8 rolls', 'Toilettenpapier 8 Rollen', '{toilet paper,papel higienico}', 'household'),
  ('kaffee gemahlen 500g', 'Cafe molido 500g', 'Ground coffee 500g', 'Kaffee gemahlen 500g', '{ground coffee,kaffee}', 'beverages'),
  ('rinderhack 500g', 'Carne picada de ternera 500g', 'Ground beef 500g', 'Rinderhack 500g', '{ground beef,rinderhack,beef mince}', 'meat'),
  ('ibuprofen 400mg', 'Ibuprofeno 400mg', 'Ibuprofen 400mg', 'Ibuprofen 400mg', '{pain relief,ibuprofen}', 'pharmacy'),
  ('baklava 250g', 'Baklava 250g', 'Baklava 250g', 'Baklava 250g', '{baklava,sweet pastry}', 'bakery')
on conflict (normalized_name) do update
set
  display_name_es = excluded.display_name_es,
  display_name_en = excluded.display_name_en,
  display_name_de = excluded.display_name_de,
  synonyms = excluded.synonyms,
  product_group = excluded.product_group,
  updated_at = now();

with seeded_establishments as (
  select id, external_id, osm_category, district
  from establishments
  where external_source = 'osm-overpass'
    and external_id in (
      'node/667451730',
      'node/2882043823',
      'node/4381394723',
      'way/142947685',
      'node/4761858224',
      'node/250195921',
      'node/8208959404',
      'node/3121381082'
    )
),
rules_generated_candidates as (
  select
    e.id as establishment_id,
    p.id as canonical_product_id,
    'rules_generated'::source_type_enum as source_type,
    'v1_osm_category_to_product_group'::text as generation_method,
    case
      when e.osm_category = 'supermarket' then 0.9200
      when e.osm_category in ('convenience', 'beverages', 'kiosk') then 0.7800
      when e.osm_category = 'pharmacy' then 0.9000
      when e.osm_category = 'butcher' then 0.8600
      when e.osm_category = 'bakery' then 0.8500
      else 0.6500
    end as confidence,
    'likely'::validation_status_enum as validation_status,
    null::text as validation_notes,
    ('Matched from OSM category "' || coalesce(e.osm_category, 'unknown') || '" and product group "' || p.product_group || '".')::text
      as why_this_product_matches,
    array['retail', coalesce(e.osm_category, 'unknown'), p.product_group]::text[] as category_path,
    jsonb_build_object(
      'rule_set', 'berlin_min_v1',
      'inferred_from', 'osm_category',
      'osm_category', e.osm_category,
      'district', e.district
    ) as inferred_from
  from seeded_establishments e
  join canonical_products p
    on (
      (e.osm_category = 'supermarket' and p.product_group in ('beverages', 'groceries', 'fresh_produce', 'personal_care', 'household')) or
      (e.osm_category in ('convenience', 'beverages', 'kiosk') and p.product_group in ('beverages', 'groceries', 'household', 'personal_care')) or
      (e.osm_category = 'pharmacy' and p.product_group in ('pharmacy', 'personal_care')) or
      (e.osm_category = 'butcher' and p.product_group in ('meat', 'groceries')) or
      (e.osm_category = 'bakery' and p.normalized_name in ('brot weizen', 'kaffee gemahlen 500g', 'hafermilch 1l', 'baklava 250g'))
    )
)
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
  inferred_from
)
select
  establishment_id,
  canonical_product_id,
  source_type,
  generation_method,
  confidence,
  validation_status,
  validation_notes,
  why_this_product_matches,
  category_path,
  inferred_from
from rules_generated_candidates
on conflict (establishment_id, canonical_product_id, source_type, generation_method) do update
set
  confidence = excluded.confidence,
  validation_status = excluded.validation_status,
  validation_notes = excluded.validation_notes,
  why_this_product_matches = excluded.why_this_product_matches,
  category_path = excluded.category_path,
  inferred_from = excluded.inferred_from,
  updated_at = now();

-- Minimal examples for all source_type values
with refs as (
  select
    (select id from establishments where external_source = 'osm-overpass' and external_id = 'way/142947685') as aldi_id,
    (select id from establishments where external_source = 'osm-overpass' and external_id = 'node/667451730') as abu_laila_id,
    (select id from establishments where external_source = 'osm-overpass' and external_id = 'node/4381394723') as afro_asia_id,
    (select id from establishments where external_source = 'osm-overpass' and external_id = 'node/250195921') as apotheke_id,
    (select id from canonical_products where normalized_name = 'vollmilch 1l') as vollmilch_id,
    (select id from canonical_products where normalized_name = 'baklava 250g') as baklava_id,
    (select id from canonical_products where normalized_name = 'olivenoel 1l') as olivenoel_id,
    (select id from canonical_products where normalized_name = 'ibuprofen 400mg') as ibuprofen_id,
    (select id from canonical_products where normalized_name = 'brot weizen') as brot_id
)
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
  inferred_from
)
select
  x.establishment_id,
  x.canonical_product_id,
  x.source_type,
  x.generation_method,
  x.confidence,
  x.validation_status,
  x.validation_notes,
  x.why_this_product_matches,
  x.category_path,
  x.inferred_from
from refs r
join lateral (
  values
    (
      r.aldi_id, r.vollmilch_id, 'imported'::source_type_enum, 'osm_moabit_template_import_v1', 0.9500::numeric(5,4),
      'likely'::validation_status_enum, 'Imported from prebuilt Moabit template.',
      'Imported candidate from existing dataset relation.',
      array['import', 'osm-template', 'beverages']::text[],
      jsonb_build_object('inferred_from', 'dataset_import', 'dataset', 'data/moabit/store_products_template.csv')
    ),
    (
      r.abu_laila_id, r.baklava_id, 'merchant_added'::source_type_enum, 'merchant_portal_manual_v1', 0.9900::numeric(5,4),
      'validated'::validation_status_enum, 'Added directly by merchant.',
      'Merchant confirmed this is a regular product.',
      array['merchant', 'manual', 'bakery']::text[],
      jsonb_build_object('inferred_from', 'merchant_input', 'merchant_note', 'core pastry')
    ),
    (
      r.afro_asia_id, r.olivenoel_id, 'ai_generated'::source_type_enum, 'gpt_candidate_suggester_v1', 0.6400::numeric(5,4),
      'unvalidated'::validation_status_enum, 'AI suggestion pending verification.',
      'Suggested by AI from neighborhood and shop profile.',
      array['ai', 'candidate-generation', 'groceries']::text[],
      jsonb_build_object('inferred_from', 'ai_model', 'model', 'gpt_candidate_suggester_v1')
    ),
    (
      r.apotheke_id, r.ibuprofen_id, 'user_validated'::source_type_enum, 'consumer_feedback_validation_v1', 0.9800::numeric(5,4),
      'validated'::validation_status_enum, 'Validated from repeated user confirmations.',
      'Users repeatedly confirmed availability.',
      array['user', 'validation', 'pharmacy']::text[],
      jsonb_build_object('inferred_from', 'user_feedback', 'votes', 6)
    ),
    (
      r.abu_laila_id, r.brot_id, 'rules_generated'::source_type_enum, 'v1_osm_category_to_product_group', 0.1000::numeric(5,4),
      'rejected'::validation_status_enum, 'Rejected by manual review for this establishment.',
      'Rule matched initially but was rejected after review.',
      array['rules', 'review', 'rejected']::text[],
      jsonb_build_object('inferred_from', 'manual_review', 'review_decision', 'rejected')
    )
) as x (
  establishment_id,
  canonical_product_id,
  source_type,
  generation_method,
  confidence,
  validation_status,
  validation_notes,
  why_this_product_matches,
  category_path,
  inferred_from
) on true
where x.establishment_id is not null
  and x.canonical_product_id is not null
on conflict (establishment_id, canonical_product_id, source_type, generation_method) do update
set
  confidence = excluded.confidence,
  validation_status = excluded.validation_status,
  validation_notes = excluded.validation_notes,
  why_this_product_matches = excluded.why_this_product_matches,
  category_path = excluded.category_path,
  inferred_from = excluded.inferred_from,
  updated_at = now();
