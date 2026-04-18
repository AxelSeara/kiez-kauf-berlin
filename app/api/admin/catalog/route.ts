import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type CanonicalProductRow = {
  id: number;
  normalized_name: string;
  product_group: string;
};

type TaxonomyRow = {
  slug: string;
  parent_slug: string | null;
  display_name_en: string;
  display_name_de: string;
  is_searchable: boolean;
};

type EstablishmentCategoryRow = {
  app_categories: string[] | null;
};

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const supabase = getSupabaseAdminClient();

    const [{ data: products, error: productsError }, { data: taxonomy, error: taxonomyError }, { data: establishments, error: establishmentsError }] =
      await Promise.all([
        supabase
          .from("canonical_products")
          .select("id, normalized_name, product_group")
          .order("product_group", { ascending: true })
          .limit(5000),
        supabase
          .from("app_category_taxonomy")
          .select("slug, parent_slug, display_name_en, display_name_de, is_searchable")
          .order("slug", { ascending: true })
          .limit(1500),
        supabase.from("establishments").select("app_categories").limit(10000)
      ]);

    if (productsError) throw new Error(productsError.message);
    if (taxonomyError) throw new Error(taxonomyError.message);
    if (establishmentsError) throw new Error(establishmentsError.message);

    const productRows = (products ?? []) as CanonicalProductRow[];
    const taxonomyRows = (taxonomy ?? []) as TaxonomyRow[];
    const establishmentRows = (establishments ?? []) as EstablishmentCategoryRow[];

    const productsByGroup = new Map<string, { group: string; count: number; sample: string[] }>();
    for (const row of productRows) {
      const key = row.product_group?.trim() || "uncategorized";
      const entry = productsByGroup.get(key) ?? { group: key, count: 0, sample: [] };
      entry.count += 1;
      if (entry.sample.length < 6) {
        entry.sample.push(row.normalized_name);
      }
      productsByGroup.set(key, entry);
    }

    const establishmentsByCategory = new Map<string, number>();
    for (const row of establishmentRows) {
      const categories = Array.isArray(row.app_categories) ? row.app_categories : [];
      for (const category of categories) {
        const key = category?.trim();
        if (!key) continue;
        establishmentsByCategory.set(key, (establishmentsByCategory.get(key) ?? 0) + 1);
      }
    }

    const taxonomyWithCounts = taxonomyRows.map((row) => ({
      ...row,
      establishment_count: establishmentsByCategory.get(row.slug) ?? 0
    }));

    return NextResponse.json({
      totals: {
        taxonomy_categories: taxonomyRows.length,
        canonical_products: productRows.length,
        establishments_with_categories: establishmentRows.filter((row) => (row.app_categories ?? []).length > 0).length
      },
      categories: taxonomyWithCounts,
      products_by_group: [...productsByGroup.values()].sort((a, b) => b.count - a.count)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin catalog error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

