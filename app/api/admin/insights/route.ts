import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SearchRow = {
  search_term: string;
  category: string | null;
  district: string | null;
  radius_km: number | null;
  results_count: number | null;
  has_results: boolean | null;
  endpoint: string | null;
  timestamp: string;
};

function normalizeTerm(value: string) {
  return value.trim().toLowerCase();
}

function toDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();

    const [{ data: searches, error: searchesError }, { count: establishmentCount, error: establishmentError }, { count: canonicalCount, error: canonicalError }] =
      await Promise.all([
        supabase
          .from("searches")
          .select("search_term, category, district, radius_km, results_count, has_results, endpoint, timestamp")
          .gte("timestamp", since)
          .order("timestamp", { ascending: false })
          .limit(5000),
        supabase.from("establishments").select("id", { count: "exact", head: true }),
        supabase.from("canonical_products").select("id", { count: "exact", head: true })
      ]);

    if (searchesError) {
      throw new Error(searchesError.message);
    }
    if (establishmentError) {
      throw new Error(establishmentError.message);
    }
    if (canonicalError) {
      throw new Error(canonicalError.message);
    }

    const rows = (searches ?? []) as SearchRow[];

    let resolvedCount = 0;
    let unresolvedCount = 0;
    let totalResults = 0;

    const topTermsMap = new Map<string, { term: string; total: number; unresolved: number }>();
    const unresolvedRecent: SearchRow[] = [];
    const noResultByDay = new Map<string, number>();
    const endpointStats = new Map<string, number>();

    for (const row of rows) {
      const term = normalizeTerm(row.search_term);
      if (!term) {
        continue;
      }

      const hasResults = Boolean(row.has_results);
      const resultCount = Number.isFinite(row.results_count ?? null) ? Number(row.results_count ?? 0) : 0;
      if (hasResults) {
        resolvedCount += 1;
      } else {
        unresolvedCount += 1;
        unresolvedRecent.push(row);
        const day = toDayKey(row.timestamp);
        noResultByDay.set(day, (noResultByDay.get(day) ?? 0) + 1);
      }
      totalResults += Math.max(resultCount, 0);

      const existing = topTermsMap.get(term) ?? { term, total: 0, unresolved: 0 };
      existing.total += 1;
      if (!hasResults) {
        existing.unresolved += 1;
      }
      topTermsMap.set(term, existing);

      const endpoint = row.endpoint?.trim() || "unknown";
      endpointStats.set(endpoint, (endpointStats.get(endpoint) ?? 0) + 1);
    }

    const topTerms = [...topTermsMap.values()]
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return b.unresolved - a.unresolved;
      })
      .slice(0, 20);

    const unresolvedGrouped = [...topTermsMap.values()]
      .filter((entry) => entry.unresolved > 0)
      .sort((a, b) => b.unresolved - a.unresolved)
      .slice(0, 20);

    const noResultTrend = [...noResultByDay.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-14);

    const recentUnresolved = unresolvedRecent
      .slice(0, 30)
      .map((item) => ({
        search_term: item.search_term,
        category: item.category,
        district: item.district,
        radius_km: item.radius_km,
        results_count: item.results_count,
        timestamp: item.timestamp
      }));

    const totalSearches = rows.length;
    const avgResultsPerSearch = totalSearches > 0 ? Number((totalResults / totalSearches).toFixed(2)) : 0;

    return NextResponse.json({
      window_days: 30,
      totals: {
        searches: totalSearches,
        resolved: resolvedCount,
        unresolved: unresolvedCount,
        unresolved_rate: totalSearches > 0 ? Number((unresolvedCount / totalSearches).toFixed(4)) : 0,
        avg_results_per_search: avgResultsPerSearch,
        establishments_total: establishmentCount ?? 0,
        canonical_products_total: canonicalCount ?? 0
      },
      top_terms: topTerms,
      unresolved_terms: unresolvedGrouped,
      unresolved_recent: recentUnresolved,
      unresolved_trend_14d: noResultTrend,
      endpoint_usage: [...endpointStats.entries()]
        .map(([endpoint, count]) => ({ endpoint, count }))
        .sort((a, b) => b.count - a.count)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin insights error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

