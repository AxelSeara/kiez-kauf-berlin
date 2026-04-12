export function buildDirectionsUrl(args: {
  destinationLat: number;
  destinationLng: number;
  originLat?: number;
  originLng?: number;
}): string {
  const { destinationLat, destinationLng, originLat, originLng } = args;

  if (typeof originLat === "number" && typeof originLng === "number") {
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${originLat}%2C${originLng}%3B${destinationLat}%2C${destinationLng}`;
  }

  return `https://www.openstreetmap.org/?mlat=${destinationLat}&mlon=${destinationLng}#map=16/${destinationLat}/${destinationLng}`;
}

type TravelMode = "walk" | "bike";

const TRAVEL_ESTIMATION = {
  walk: {
    speedKmh: 4.8,
    routeFactor: 1.3
  },
  bike: {
    speedKmh: 14,
    routeFactor: 1.2
  }
} as const;

export function estimateRouteDistanceMeters(distanceMeters: number, mode: TravelMode): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return 0;
  }
  return distanceMeters * TRAVEL_ESTIMATION[mode].routeFactor;
}

export function estimateTravelMinutes(distanceMeters: number, mode: TravelMode): number {
  const routeDistanceMeters = estimateRouteDistanceMeters(distanceMeters, mode);
  if (routeDistanceMeters <= 0) {
    return 0;
  }
  const metersPerMinute = (TRAVEL_ESTIMATION[mode].speedKmh * 1000) / 60;
  return Math.max(1, Math.round(routeDistanceMeters / metersPerMinute));
}

export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
