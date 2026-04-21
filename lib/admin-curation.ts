type CurationEventInput = {
  eventType:
    | "establishment_update"
    | "category_set"
    | "product_add"
    | "product_validate"
    | "product_reject"
    | "product_remove"
    | "alias_add"
    | "rule_suggest"
    | "rule_apply";
  entityType: "establishment" | "establishment_product" | "alias" | "rule";
  establishmentId?: number | null;
  canonicalProductId?: number | null;
  appCategory?: string | null;
  productGroup?: string | null;
  reason?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  actorType?: string | null;
  actorId?: string | null;
};

function normalizeTag(value: string | null | undefined): string | null {
  const clean = String(value ?? "").trim().toLowerCase();
  return clean || null;
}

function isSchemaCompatibilityError(message: string | undefined): boolean {
  const lower = String(message ?? "").toLowerCase();
  return lower.includes("does not exist") || lower.includes("relation") || lower.includes("column");
}

export async function recordCurationEvent(
  supabaseAdmin: {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> | { error: { message: string } | null };
    };
  },
  input: CurationEventInput
): Promise<void> {
  const payload = {
    event_type: input.eventType,
    entity_type: input.entityType,
    establishment_id: input.establishmentId ?? null,
    canonical_product_id: input.canonicalProductId ?? null,
    app_category: normalizeTag(input.appCategory),
    product_group: normalizeTag(input.productGroup),
    reason: input.reason?.trim() || null,
    before_state: input.beforeState ?? {},
    after_state: input.afterState ?? {},
    metadata: input.metadata ?? {},
    actor_type: input.actorType?.trim() || "admin",
    actor_id: input.actorId?.trim() || null
  };

  const { error } = await supabaseAdmin.from("curation_events").insert(payload);
  if (!error) {
    return;
  }

  if (isSchemaCompatibilityError(error.message)) {
    console.warn("[curation-events] table not available yet:", error.message);
    return;
  }

  throw new Error(error.message);
}
