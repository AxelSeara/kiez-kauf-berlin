# Admin curation feedback loop (Phase F)

Esta fase añade una capa de curación manual trazable y aprendizaje conservador de reglas sin tocar ranking/UI final.

## Objetivo

1. Curar negocio por negocio desde `/admin`.
2. Registrar cada acción manual como señal de aprendizaje.
3. Proponer reglas nuevas solo cuando hay evidencia suficiente.
4. Aplicar reglas de forma conservadora y auditable.

## Tablas nuevas

### `app_category_group_rules`

Reglas activas para mapping `app_category -> product_group`.

Campos clave:

- `app_category`, `product_group` (unique)
- `base_confidence`
- `reason`
- `source` (`seed | curation | manual`)
- `support_count`, `precision_score`
- `auto_apply_eligible`
- `is_active`

Uso:

- `generate-rule-candidates` y `district refresh` leen esta tabla (ya no hay reglas hardcodeadas en código).

### `curation_events`

Log append-only de acciones de curación.

Eventos:

- `establishment_update`
- `category_set`
- `product_add`
- `product_validate`
- `product_reject`
- `product_remove`
- `alias_add`
- `rule_suggest`
- `rule_apply`

Uso:

- Fuente de verdad para aprender sugerencias de reglas.

### `curation_rule_suggestions`

Sugerencias agregadas por ventana temporal.

Campos clave:

- `app_category`, `product_group`, `window_days` (unique)
- `support_count`, `positive_count`, `precision_score`
- `auto_apply_eligible`
- `status` (`suggested | applied | discarded`)
- `generated_at`, `applied_at`

## Flujo operativo

1. Admin hace curación individual:
   - editar categorías/estado del negocio
   - añadir/validar/rechazar/quitar productos
   - añadir aliases
2. API registra `curation_events`.
3. Job genera sugerencias (`curation_rule_suggestions`) desde eventos.
4. Job aplica solo sugerencias con thresholds conservadores a `app_category_group_rules`.
5. Se refresca dataset de búsqueda.

## Endpoints admin implicados

- `PATCH /api/admin/establishments/:id`
- `POST/PATCH/DELETE /api/admin/establishments/:id/products`
- `POST /api/admin/canonical-products/aliases`
- `GET/POST /api/admin/curation/suggestions`

## Scripts

```bash
npm run generate:curation-rule-suggestions -- --window-days=90 --min-support=20 --min-positive=10 --min-precision=0.9
npm run apply:curation-rules -- --window-days=90 --min-support=20 --min-positive=10 --min-precision=0.9 --max-apply=120
npm run build:search-dataset
```

## Notas de seguridad y mantenimiento

- Mantener umbrales altos al principio para evitar sobregeneración.
- Si no hay suficiente curación manual, no se aplican reglas (comportamiento esperado).
- `validated/rejected` manuales no se sobreescriben por reglas.
- Todo cambio automático queda trazado por `rule_suggest` y `rule_apply`.
