# Lean v1 Pack (Berlin Data)

Objetivo: mejorar calidad util y contener crecimiento de base de datos sin rehacer arquitectura.

## Que incluye

1. Menos sobregeneracion por tienda
- `generate-ai-candidates` ahora usa limites mas conservadores:
  - max por tienda fuerte: 5
  - sin website: 2
  - default global: 5
- fallback heuristico mas conservador en `confidence`.

2. Menos escrituras redundantes
- Upserts en:
  - `generate-rule-candidates`
  - `generate-ai-candidates`
  - `merge-candidates`
- Solo actualizan cuando hay cambios reales (`is distinct from`), evitando ruido en `updated_at` y auditoria.

3. Recorte de resultados fusionados
- `merge-candidates` baja default de `--max-products-per-establishment` de `14` a `8`.

4. Guardrails SQL para serving/performance
- Migracion: `supabase/migrations/20260419092218_lean_v1_guardrails.sql`
- Incluye:
  - `pg_trgm`
  - indice GIN trigram para `product_normalized_name`
  - indices en `canonical_product_id`, `product_group` y filtros de merge/candidates.

5. Pruning reproducible de auditoria
- Script nuevo: `scripts/pipeline/prune-audit.mjs`
- Mantiene N eventos recientes por candidato y conserva eventos de validacion.

6. Orquestacion lean completa
- Script nuevo: `scripts/pipeline/lean-v1-refresh.mjs`
- Ejecuta pipeline completo + prune de auditoria.

7. Control de coste + trazabilidad IA
- Nuevo tracking por run:
  - `ai_enrichment_runs`
  - `ai_enrichment_run_items`
- Flags nuevos en `generate-ai-candidates`:
  - `--district-scope=mitte`
  - `--max-cost-usd-per-run=3`
  - `--max-cost-usd-per-day=2`
  - `--max-establishments=250`
  - `--require-website-signals=true`
  - `--only-ambiguous=true`
- Se guarda hash de prompt (`prompt_hash`) y métricas agregadas (tokens/coste), no prompts completos.

8. Coherencia merged -> candidates
- Script nuevo: `scripts/pipeline/repair-merged-candidate-coherence.mjs`
- Rellena candidatos faltantes desde `establishment_product_merged` para evitar huérfanos históricos.

## Comandos

Aplicar migraciones:

```bash
supabase db push
```

Pipeline completo lean:

```bash
npm run refresh:berlin:lean-v1
```

Pipeline lean con reanudacion:

```bash
npm run refresh:berlin:lean-v1 -- --resume
```

Piloto IA conservador en Mitte:

```bash
npm run refresh:mitte:ai-pilot
```

Forzar modo sin LLM real (solo reglas + website):

```bash
npm run refresh:berlin:lean-v1 -- --force-heuristic
```

Forzar reparación de coherencia merged->candidates durante refresh:

```bash
npm run refresh:berlin:lean-v1 -- --repair-coherence=true
```

Prune de auditoria manual:

```bash
npm run maintenance:prune-audit -- --keep-latest-per-candidate=2
```

Dry-run prune:

```bash
npm run maintenance:prune-audit -- --dry-run
```

## Defaults recomendados (fase de pulido)

- `--max-products-per-establishment=8`
- `--keep-latest-per-candidate=2`
- revisar semanalmente:
  - top productos mas repetidos
  - tiendas con >8 productos
  - tasa `has_results = false`
  - crecimiento de `establishment_product_candidate_audit`
