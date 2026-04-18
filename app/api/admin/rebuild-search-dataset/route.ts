import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.rpc("refresh_search_product_establishment_mv");
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      refreshed_at: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected dataset rebuild error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

