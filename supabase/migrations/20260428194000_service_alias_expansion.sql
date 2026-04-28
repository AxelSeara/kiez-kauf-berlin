-- Expand service aliases for MVP fallback coverage in Moabit-first search.

insert into public.canonical_service_aliases (canonical_service_id, lang, alias, priority)
select s.id, a.lang, a.alias, a.priority
from public.canonical_services s
join (
  values
    ('phone-repair', 'en', 'iphone repair', 96),
    ('phone-repair', 'en', 'mobile phone repair', 94),
    ('phone-repair', 'en', 'phone screen repair', 95),
    ('phone-repair', 'en', 'replace phone battery', 90),
    ('phone-repair', 'de', 'handy akku wechseln', 90),
    ('phone-repair', 'de', 'iphone reparatur', 95),
    ('phone-repair', 'es', 'arreglar movil', 88),
    ('key-cutting', 'en', 'key copy', 98),
    ('key-cutting', 'en', 'duplicate key', 96),
    ('key-cutting', 'en', 'copy keys', 96),
    ('key-cutting', 'de', 'schluessel nachmachen', 97),
    ('key-cutting', 'de', 'schlussel kopieren', 95),
    ('key-cutting', 'es', 'copia de llave', 90),
    ('tailoring', 'en', 'clothing alterations', 90),
    ('tailoring', 'en', 'hemming service', 84),
    ('tailoring', 'de', 'aenderungsschneiderei', 92),
    ('shoe-repair', 'en', 'shoe sole repair', 88),
    ('shoe-repair', 'de', 'schuhe reparieren', 91),
    ('bike-repair', 'en', 'bicycle repair', 94),
    ('bike-repair', 'en', 'fix bike', 84),
    ('copy-print', 'en', 'copy shop', 95),
    ('copy-print', 'en', 'print documents', 88),
    ('watch-battery-replacement', 'en', 'watch battery', 96),
    ('watch-battery-replacement', 'de', 'uhr batterie wechsel', 95),
    ('pedicure', 'en', 'foot care', 76),
    ('pedicure', 'es', 'pedicura', 95),
    ('manicure', 'en', 'nail care', 74),
    ('manicure', 'es', 'manicura', 95)
) a(slug, lang, alias, priority)
  on a.slug = s.slug
on conflict on constraint canonical_service_aliases_unique
 do update set
   priority = greatest(public.canonical_service_aliases.priority, excluded.priority),
   is_active = true,
   updated_at = now();
