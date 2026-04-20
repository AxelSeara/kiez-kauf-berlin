import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type AliasPayload = {
  canonicalProductId?: number;
  alias?: string;
  lang?: string;
  priority?: number;
  isActive?: boolean;
};

const ALLOWED_LANGS = new Set(["und", "en", "de", "es"]);

function sanitizeAlias(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function sanitizeLang(value: unknown) {
  const lang = String(value ?? "und")
    .trim()
    .toLowerCase();
  if (!ALLOWED_LANGS.has(lang)) {
    return "und";
  }
  return lang;
}

function sanitizePriority(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 75;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export async function POST(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as AliasPayload;
    const canonicalProductId = Number(body.canonicalProductId);
    const alias = sanitizeAlias(body.alias);
    const lang = sanitizeLang(body.lang);
    const priority = sanitizePriority(body.priority);
    const isActive = body.isActive !== false;

    if (!Number.isFinite(canonicalProductId)) {
      return NextResponse.json({ error: "canonicalProductId is required." }, { status: 400 });
    }
    if (!alias || alias.length < 2) {
      return NextResponse.json({ error: "alias is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    const { data: canonicalProduct, error: canonicalError } = await supabase
      .from("canonical_products")
      .select("id, normalized_name")
      .eq("id", canonicalProductId)
      .maybeSingle();

    if (canonicalError) {
      throw new Error(canonicalError.message);
    }
    if (!canonicalProduct) {
      return NextResponse.json({ error: "Canonical product not found." }, { status: 404 });
    }

    const { data: existingAlias, error: existingAliasError } = await supabase
      .from("canonical_product_aliases")
      .select("id, canonical_product_id, alias, lang, priority, is_active")
      .eq("canonical_product_id", canonicalProductId)
      .eq("lang", lang)
      .ilike("alias", alias)
      .maybeSingle();

    if (existingAliasError) {
      throw new Error(existingAliasError.message);
    }

    if (existingAlias?.id) {
      const { data: updatedAlias, error: updateError } = await supabase
        .from("canonical_product_aliases")
        .update({
          priority,
          is_active: isActive
        })
        .eq("id", existingAlias.id)
        .select("id, canonical_product_id, alias, lang, priority, is_active, updated_at")
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      return NextResponse.json({
        status: "updated",
        alias: updatedAlias,
        canonical_product: canonicalProduct
      });
    }

    const { data: insertedAlias, error: insertError } = await supabase
      .from("canonical_product_aliases")
      .insert({
        canonical_product_id: canonicalProductId,
        alias,
        lang,
        priority,
        is_active: isActive
      })
      .select("id, canonical_product_id, alias, lang, priority, is_active, updated_at")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({
      status: "inserted",
      alias: insertedAlias,
      canonical_product: canonicalProduct
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected alias upsert error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
