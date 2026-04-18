import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 25;
  }
  return Math.max(5, Math.min(80, Math.trunc(parsed)));
}

function sanitizeQuery(value: string | null) {
  return (value ?? "")
    .trim()
    .replace(/[%_]/g, "")
    .slice(0, 80);
}

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { searchParams } = new URL(request.url);
    const q = sanitizeQuery(searchParams.get("q"));
    const limit = parseLimit(searchParams.get("limit"));

    let query = supabase
      .from("canonical_products")
      .select("id, normalized_name, display_name_en, display_name_de, display_name_es, product_group, synonyms")
      .order("normalized_name", { ascending: true })
      .limit(limit);

    if (q) {
      const pattern = `%${q}%`;
      query = query.or(
        `normalized_name.ilike.${pattern},display_name_en.ilike.${pattern},display_name_de.ilike.${pattern},display_name_es.ilike.${pattern}`
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({
      rows: data ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected canonical products admin error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

