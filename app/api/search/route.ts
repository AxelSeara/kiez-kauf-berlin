import { NextRequest, NextResponse } from "next/server";
import { getBerlinCenter, searchOffers } from "@/lib/data";

const DEFAULT_RADIUS_METERS = 2000;
const MIN_RADIUS_METERS = 300;
const MAX_RADIUS_METERS = 15000;

function parseNumber(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const q = searchParams.get("q")?.trim() ?? "";
    if (!q) {
      return NextResponse.json(
        { error: "Query parameter q is required." },
        {
          status: 400
        }
      );
    }

    const rawLat = searchParams.get("lat");
    const rawLng = searchParams.get("lng");
    const rawRadius = searchParams.get("radius");

    const parsedLat = parseNumber(rawLat);
    const parsedLng = parseNumber(rawLng);
    const parsedRadius = parseNumber(rawRadius);

    if (rawLat !== null && parsedLat === null) {
      return NextResponse.json({ error: "Invalid lat parameter." }, { status: 400 });
    }
    if (rawLng !== null && parsedLng === null) {
      return NextResponse.json({ error: "Invalid lng parameter." }, { status: 400 });
    }
    if (rawRadius !== null && parsedRadius === null) {
      return NextResponse.json({ error: "Invalid radius parameter." }, { status: 400 });
    }

    const berlinCenter = getBerlinCenter();
    const lat = clamp(parsedLat ?? berlinCenter.lat, -90, 90);
    const lng = clamp(parsedLng ?? berlinCenter.lng, -180, 180);
    const radius = Math.round(
      clamp(parsedRadius ?? DEFAULT_RADIUS_METERS, MIN_RADIUS_METERS, MAX_RADIUS_METERS)
    );

    const results = await searchOffers({
      query: q,
      lat,
      lng,
      radiusMeters: radius
    });

    return NextResponse.json({
      query: q,
      origin: { lat, lng },
      radius,
      results
    });
  } catch (error) {
    console.error("Search API failed", error);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
