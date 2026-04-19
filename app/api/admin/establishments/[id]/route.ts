import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type EstablishmentDetailRow = {
  id: number;
  external_source: string;
  external_id: string;
  name: string;
  address: string;
  district: string;
  lat: number;
  lon: number;
  osm_category: string | null;
  app_categories: string[] | null;
  website: string | null;
  phone: string | null;
  opening_hours: string | null;
  description: string | null;
  active_status: "active" | "inactive" | "temporarily_closed" | "unknown";
  updated_at: string;
};

type ProductDetailRow = {
  canonical_product_id: number;
  confidence: number;
  validation_status: "unvalidated" | "likely" | "validated" | "rejected";
  why_this_product_matches: string | null;
  primary_source_type: string;
  canonical_products:
    | {
        normalized_name: string;
        display_name_en: string;
        display_name_de: string;
        display_name_es: string;
        group_key?: string | null;
        product_group: string;
      }
    | {
        normalized_name: string;
        display_name_en: string;
        display_name_de: string;
        display_name_es: string;
        group_key?: string | null;
        product_group: string;
      }[]
    | null;
};

function parseEstablishmentId(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.trunc(parsed);
}

function sanitizeCategories(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const unique = new Set<string>();
  for (const entry of input) {
    if (typeof entry !== "string") continue;
    const clean = entry.trim().toLowerCase().replace(/\s+/g, "-");
    if (!clean) continue;
    unique.add(clean.slice(0, 60));
  }
  return [...unique];
}

function coerceNullableString(input: unknown, maxLength = 300) {
  if (typeof input !== "string") {
    return null;
  }
  const clean = input.trim();
  if (!clean) {
    return null;
  }
  return clean.slice(0, maxLength);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const establishmentId = parseEstablishmentId(id);
  if (!establishmentId) {
    return NextResponse.json({ error: "Invalid establishment id." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdminClient();

    const [{ data: establishment, error: establishmentError }, { data: products, error: productsError }] =
      await Promise.all([
        supabase
          .from("establishments")
          .select(
            "id, external_source, external_id, name, address, district, lat, lon, osm_category, app_categories, website, phone, opening_hours, description, active_status, updated_at"
          )
          .eq("id", establishmentId)
          .single(),
        supabase
          .from("establishment_product_merged")
          .select(
            "canonical_product_id, confidence, validation_status, why_this_product_matches, primary_source_type, canonical_products(normalized_name, display_name_en, display_name_de, display_name_es, group_key, product_group)"
          )
          .eq("establishment_id", establishmentId)
          .neq("validation_status", "rejected")
          .order("confidence", { ascending: false })
          .limit(120)
      ]);

    if (establishmentError) throw new Error(establishmentError.message);
    if (productsError) throw new Error(productsError.message);

    const establishmentRow = establishment as EstablishmentDetailRow | null;
    if (!establishmentRow) {
      return NextResponse.json({ error: "Establishment not found." }, { status: 404 });
    }

    const mappedProducts = ((products ?? []) as ProductDetailRow[]).map((item) => {
      const product = Array.isArray(item.canonical_products)
        ? item.canonical_products[0]
        : item.canonical_products;

      return {
        canonical_product_id: item.canonical_product_id,
        confidence: item.confidence,
        validation_status: item.validation_status,
        why_this_product_matches: item.why_this_product_matches,
        primary_source_type: item.primary_source_type,
        product: product
          ? {
              normalized_name: product.normalized_name,
              display_name_en: product.display_name_en,
              display_name_de: product.display_name_de,
              display_name_es: product.display_name_es,
              product_group: product.group_key ?? product.product_group ?? "uncategorized"
            }
          : null
      };
    });

    return NextResponse.json({
      establishment: establishmentRow,
      products: mappedProducts
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin establishment detail error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const establishmentId = parseEstablishmentId(id);
  if (!establishmentId) {
    return NextResponse.json({ error: "Invalid establishment id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      appCategories?: unknown;
      activeStatus?: unknown;
      website?: unknown;
      phone?: unknown;
      openingHours?: unknown;
      description?: unknown;
      district?: unknown;
    };

    const activeStatus =
      body.activeStatus === "active" ||
      body.activeStatus === "inactive" ||
      body.activeStatus === "temporarily_closed" ||
      body.activeStatus === "unknown"
        ? body.activeStatus
        : null;

    const updatePayload: Record<string, unknown> = {};
    if (body.appCategories !== undefined) {
      updatePayload.app_categories = sanitizeCategories(body.appCategories);
    }
    if (activeStatus) {
      updatePayload.active_status = activeStatus;
    }
    if (body.website !== undefined) {
      updatePayload.website = coerceNullableString(body.website, 220);
    }
    if (body.phone !== undefined) {
      updatePayload.phone = coerceNullableString(body.phone, 100);
    }
    if (body.openingHours !== undefined) {
      updatePayload.opening_hours = coerceNullableString(body.openingHours, 400);
    }
    if (body.description !== undefined) {
      updatePayload.description = coerceNullableString(body.description, 1200);
    }
    if (body.district !== undefined) {
      updatePayload.district = coerceNullableString(body.district, 120);
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("establishments")
      .update(updatePayload)
      .eq("id", establishmentId)
      .select(
        "id, external_source, external_id, name, address, district, lat, lon, osm_category, app_categories, website, phone, opening_hours, description, active_status, updated_at"
      )
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({
      establishment: data
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin establishment update error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
