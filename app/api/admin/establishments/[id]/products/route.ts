import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ExistingMergedRow = {
  id: number;
  confidence: number;
  validation_status: "unvalidated" | "likely" | "validated" | "rejected";
  primary_source_type: "imported" | "rules_generated" | "ai_generated" | "merchant_added" | "user_validated" | "website_extracted" | "validated";
  merged_sources: string[] | null;
  merged_generation_methods: string[] | null;
  merged_candidate_ids: number[] | null;
  why_this_product_matches: string | null;
};

function parsePositiveInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.trunc(parsed);
}

function asReason(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const clean = value.trim();
  if (!clean) {
    return null;
  }
  return clean.slice(0, 400);
}

function asConfidence(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.92;
  }
  return Math.max(0.4, Math.min(1, parsed));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const establishmentId = parsePositiveInt(id);
  if (!establishmentId) {
    return NextResponse.json({ error: "Invalid establishment id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      canonicalProductId?: unknown;
      reason?: unknown;
      confidence?: unknown;
    };

    const canonicalProductId = parsePositiveInt(body.canonicalProductId);
    if (!canonicalProductId) {
      return NextResponse.json({ error: "canonicalProductId is required." }, { status: 400 });
    }

    const reason = asReason(body.reason);
    const confidence = asConfidence(body.confidence);
    const supabase = getSupabaseAdminClient();

    const { data: productRow, error: productError } = await supabase
      .from("canonical_products")
      .select("id")
      .eq("id", canonicalProductId)
      .single();

    if (productError || !productRow) {
      return NextResponse.json({ error: "Canonical product not found." }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const insertCandidatePayload = {
      establishment_id: establishmentId,
      canonical_product_id: canonicalProductId,
      source_type: "merchant_added",
      generation_method: "admin_panel_manual",
      confidence,
      validation_status: "validated",
      validation_notes: reason,
      why_this_product_matches: reason ?? "Manually confirmed in admin panel.",
      inferred_from: {
        source: "admin_panel",
        action: "manual_add",
        at: nowIso
      },
      source_url: null,
      extraction_method: "admin_panel_manual",
      last_checked_at: nowIso,
      freshness_score: Math.min(1, Math.max(0.8, confidence))
    };

    const { data: candidate, error: candidateError } = await supabase
      .from("establishment_product_candidates")
      .upsert(insertCandidatePayload, {
        onConflict: "establishment_id,canonical_product_id,source_type,generation_method"
      })
      .select("id")
      .single();

    if (candidateError || !candidate) {
      throw new Error(candidateError?.message ?? "Unable to upsert candidate row.");
    }

    const { data: existingMerged, error: existingMergedError } = await supabase
      .from("establishment_product_merged")
      .select(
        "id, confidence, validation_status, primary_source_type, merged_sources, merged_generation_methods, merged_candidate_ids, why_this_product_matches"
      )
      .eq("establishment_id", establishmentId)
      .eq("canonical_product_id", canonicalProductId)
      .maybeSingle();

    if (existingMergedError) {
      throw new Error(existingMergedError.message);
    }

    const current = existingMerged as ExistingMergedRow | null;
    const mergedSources = new Set<string>(current?.merged_sources ?? []);
    mergedSources.add("merchant_added");

    const mergedMethods = new Set<string>(current?.merged_generation_methods ?? []);
    mergedMethods.add("admin_panel_manual");

    const mergedCandidateIds = new Set<number>((current?.merged_candidate_ids ?? []).map((value) => Number(value)));
    mergedCandidateIds.add(candidate.id);

    const mergedPayload = {
      establishment_id: establishmentId,
      canonical_product_id: canonicalProductId,
      primary_source_type: "merchant_added",
      merged_sources: [...mergedSources] as Array<
        "imported" | "rules_generated" | "ai_generated" | "merchant_added" | "user_validated" | "website_extracted" | "validated"
      >,
      merged_generation_methods: [...mergedMethods],
      merged_candidate_ids: [...mergedCandidateIds],
      confidence: Math.max(current?.confidence ?? 0, confidence),
      validation_status: "validated",
      why_this_product_matches: reason ?? current?.why_this_product_matches ?? "Manually confirmed in admin panel.",
      inferred_from: {
        source: "admin_panel",
        action: "manual_add",
        at: nowIso
      },
      extraction_method: "admin_panel_manual",
      last_checked_at: nowIso,
      freshness_score: Math.min(1, Math.max(0.8, confidence))
    };

    const { data: merged, error: mergedError } = await supabase
      .from("establishment_product_merged")
      .upsert(mergedPayload, {
        onConflict: "establishment_id,canonical_product_id"
      })
      .select(
        "id, establishment_id, canonical_product_id, confidence, validation_status, primary_source_type, why_this_product_matches, updated_at"
      )
      .single();

    if (mergedError) {
      throw new Error(mergedError.message);
    }

    return NextResponse.json({
      candidate_id: candidate.id,
      merged
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin add product error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

