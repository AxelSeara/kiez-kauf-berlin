"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";

type CoveragePoint = {
  id: number;
  name: string;
  district: string;
  lat: number;
  lon: number;
  active_status: "active" | "inactive" | "temporarily_closed" | "unknown";
  app_categories: string[];
  product_count: number;
  updated_at: string;
};

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm"
    }
  ]
};

const BERLIN_CENTER = { lat: 52.5208, lng: 13.4094 };
const BERLIN_BOUNDS: [[number, number], [number, number]] = [
  [13.0883, 52.3383],
  [13.7612, 52.6755]
];
const BERLIN_MIN_ZOOM = 10.2;

function isValidPoint(point: CoveragePoint) {
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    typeof point.lon === "number" &&
    Number.isFinite(point.lon) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lon >= -180 &&
    point.lon <= 180
  );
}

function markerClass(status: CoveragePoint["active_status"]) {
  if (status === "active") return "admin-map-point is-active";
  if (status === "temporarily_closed") return "admin-map-point is-temp-closed";
  if (status === "inactive") return "admin-map-point is-inactive";
  return "admin-map-point is-unknown";
}

export function AdminCoverageMap({
  points,
  selectedDistrict
}: {
  points: CoveragePoint[];
  selectedDistrict: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = useRef<Map<number, MapLibreMarker>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  const safePoints = useMemo(() => points.filter(isValidPoint).slice(0, 5000), [points]);

  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current || mapRef.current) return;
    const markers = markersRef.current;

    async function initMap() {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;

      maplibreRef.current = maplibregl;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [BERLIN_CENTER.lng, BERLIN_CENTER.lat],
        zoom: 11.6,
        minZoom: BERLIN_MIN_ZOOM,
        maxZoom: 17.8,
        maxBounds: BERLIN_BOUNDS
      });

      map.addControl(
        new maplibregl.NavigationControl({
          showCompass: false,
          showZoom: true
        }),
        "top-right"
      );

      map.on("load", () => {
        if (!cancelled) setMapReady(true);
      });

      mapRef.current = map;
    }

    initMap().catch((error) => {
      console.error("[admin-coverage-map] map init failed", error);
    });

    return () => {
      cancelled = true;
      for (const marker of markers.values()) {
        marker.remove();
      }
      markers.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !mapReady) return;

    const visibleIds = new Set<number>();
    for (const point of safePoints) {
      const existing = markersRef.current.get(point.id);
      const popupHtml = `
        <div class="admin-map-popup">
          <p class="admin-map-popup-title">${point.name}</p>
          <p>${point.district}</p>
          <p>${point.active_status} · ${point.product_count} products</p>
          <p>${(point.app_categories ?? []).slice(0, 4).join(", ") || "no categories"}</p>
        </div>
      `;

      if (existing) {
        existing.setLngLat([point.lon, point.lat]);
        existing.getElement().className = markerClass(point.active_status);
      } else {
        const element = document.createElement("button");
        element.type = "button";
        element.className = markerClass(point.active_status);
        element.title = point.name;

        const marker = new maplibre.Marker({ element, anchor: "center" })
          .setLngLat([point.lon, point.lat])
          .setPopup(new maplibre.Popup({ offset: 12 }).setHTML(popupHtml))
          .addTo(map);

        markersRef.current.set(point.id, marker);
      }
      visibleIds.add(point.id);
    }

    for (const [id, marker] of markersRef.current.entries()) {
      if (visibleIds.has(id)) continue;
      marker.remove();
      markersRef.current.delete(id);
    }

    if (safePoints.length > 0) {
      const bounds = new maplibre.LngLatBounds(
        [safePoints[0].lon, safePoints[0].lat],
        [safePoints[0].lon, safePoints[0].lat]
      );
      for (const point of safePoints.slice(1)) {
        bounds.extend([point.lon, point.lat]);
      }
      map.fitBounds(bounds, {
        padding: 38,
        maxZoom: selectedDistrict ? 14.6 : 13.4,
        duration: 450
      });
    }
  }, [mapReady, safePoints, selectedDistrict]);

  return (
    <div className="admin-coverage-map-wrapper">
      <div ref={containerRef} className="admin-coverage-map bw-map" />
    </div>
  );
}
