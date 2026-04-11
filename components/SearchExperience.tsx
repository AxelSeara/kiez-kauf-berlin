"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LocalMap } from "@/components/LocalMap";
import { buildDirectionsUrl } from "@/lib/maps";
import type { Dictionary } from "@/lib/i18n";
import type { Locale, SearchResult } from "@/lib/types";

type SearchPayload = {
  query: string;
  origin: { lat: number; lng: number };
  radius: number;
  results: SearchResult[];
};

export function SearchExperience({
  locale,
  dictionary,
  initialCenter
}: {
  locale: Locale;
  dictionary: Dictionary;
  initialCenter: { lat: number; lng: number };
}) {
  const [query, setQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(2);
  const [center, setCenter] = useState(initialCenter);
  const [fallbackAddress, setFallbackAddress] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const centerLabel = useMemo(
    () => `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`,
    [center.lat, center.lng]
  );

  async function runSearch() {
    if (!query.trim()) {
      setErrorMessage(dictionary.queryRequiredError);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const params = new URLSearchParams({
        q: query,
        lat: String(center.lat),
        lng: String(center.lng),
        radius: String(Math.round(radiusKm * 1000))
      });

      const response = await fetch(`/api/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }

      const data = (await response.json()) as SearchPayload;
      setResults(data.results);
    } catch (error) {
      console.error(error);
      setErrorMessage(dictionary.searchRequestError);
    } finally {
      setIsLoading(false);
    }
  }

  function useBrowserLocation() {
    if (!navigator.geolocation) {
      setErrorMessage(dictionary.geolocationError);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCenter({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setLocationMessage(dictionary.geolocationReady);
        setErrorMessage(null);
      },
      () => {
        setErrorMessage(dictionary.geolocationError);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function resolveFallbackAddress() {
    if (!fallbackAddress.trim()) {
      return;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&bounded=1&viewbox=13.0884,52.6755,13.7612,52.3383&q=${encodeURIComponent(
          `${fallbackAddress}, Berlin`
        )}`
      );
      const data = (await response.json()) as Array<{ lat: string; lon: string }>;
      const first = data[0];

      if (!first) {
        setErrorMessage(dictionary.geolocationError);
        return;
      }

      setCenter({
        lat: Number(first.lat),
        lng: Number(first.lon)
      });
      setLocationMessage(dictionary.geolocationReady);
      setErrorMessage(null);
    } catch (error) {
      console.error(error);
      setErrorMessage(dictionary.geolocationError);
    }
  }

  async function trackRouteClick(result: SearchResult) {
    const interactionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${result.offer.id}`;

    const payload = {
      interactionId,
      storeId: result.store.id,
      productId: result.product.id,
      originLat: center.lat,
      originLng: center.lng,
      destinationLat: result.store.lat,
      destinationLng: result.store.lng,
      locale
    };

    await fetch("/api/analytics/route-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const directions = buildDirectionsUrl({
      destinationLat: result.store.lat,
      destinationLng: result.store.lng,
      originLat: center.lat,
      originLng: center.lng
    });

    window.open(directions, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="space-y-4 md:space-y-5">
      <section className="surface-card p-4 md:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.22fr)_minmax(0,0.78fr)]">
          <div className="space-y-3">
            <p className="section-title">{dictionary.searchButton}</p>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void runSearch();
                }
              }}
              placeholder={dictionary.searchPlaceholder}
              className="field-input"
            />

            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="flex items-center justify-between gap-3 rounded-xl border border-[#d8dde3] px-3 py-2">
                <span className="mono text-[0.72rem] uppercase tracking-[0.1em] text-neutral-500">
                  {dictionary.radiusLabel}
                </span>
                <input
                  type="number"
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={radiusKm}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isNaN(next)) {
                      setRadiusKm(Math.min(10, Math.max(0.5, next)));
                    }
                  }}
                  className="mono w-16 border-0 bg-transparent text-right text-sm text-neutral-700 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={runSearch}
                disabled={isLoading}
                className="btn-primary px-5 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-55"
              >
                {dictionary.searchButton}
              </button>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-[#d8dde3] bg-[#f8fafc] p-3">
            <p className="section-title">{dictionary.addressSectionTitle}</p>
            <button
              type="button"
              onClick={useBrowserLocation}
              className="btn-secondary w-full px-4 py-2 text-sm font-medium"
            >
              {dictionary.useMyLocation}
            </button>
            <label className="sr-only" htmlFor="address-fallback">
              {dictionary.locationFallbackLabel}
            </label>
            <input
              id="address-fallback"
              value={fallbackAddress}
              onChange={(event) => setFallbackAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void resolveFallbackAddress();
                }
              }}
              placeholder={dictionary.locationFallbackPlaceholder}
              autoComplete="street-address"
              className="field-input"
            />
            <button
              type="button"
              onClick={() => void resolveFallbackAddress()}
              className="btn-secondary w-full px-4 py-2 text-sm"
            >
              {dictionary.resolveLocationButton}
            </button>
          </div>
        </div>

        <div className="mt-3 border-t border-[#e4e8ee] pt-2.5">
          <p className="status-text">
            {dictionary.centerLabel}: {centerLabel}
          </p>
          {locationMessage ? <p className="status-text text-[#1f4b7a]">{locationMessage}</p> : null}
          {errorMessage ? <p className="status-text text-[#8b1d1d]">{errorMessage}</p> : null}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)] lg:items-start">
        <LocalMap
          center={center}
          results={results}
          userMarkerLabel={dictionary.mapYouAreHere}
          className="h-[45vh] min-h-[320px] lg:sticky lg:top-4 lg:h-[70vh] lg:min-h-[520px]"
        />

        <section className="space-y-3">
          <div className="surface-card p-4">
            <h2 className="text-xl font-semibold tracking-tight">{dictionary.resultsTitle}</h2>
            <p className="status-text mt-1">
              {results.length} {dictionary.itemLabel.toLowerCase()}
            </p>
          </div>

          {results.length === 0 ? (
            <p className="surface-card p-4 text-sm text-neutral-600">{dictionary.noResults}</p>
          ) : null}

          {results.map((result) => (
            <article key={result.offer.id} className="surface-card p-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold">{result.store.name}</h3>
                  <p className="text-sm text-neutral-600">{result.store.address}</p>
                  <p className="mono text-[0.72rem] text-neutral-500">
                    {result.store.district} · {result.store.openingHours}
                  </p>
                </div>

                <div className="rounded-lg border border-[#e1e6ec] bg-[#f8fafc] p-2.5">
                  <p className="mono text-[0.72rem] uppercase tracking-[0.08em] text-neutral-500">
                    {dictionary.matchedProductLabel}
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-neutral-800">{result.product.normalizedName}</p>
                  <p className="mono mt-1 text-[0.72rem] text-neutral-500">{Math.round(result.distanceMeters)} m</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/${locale}/store/${result.store.id}`}
                    className="btn-secondary px-4 py-2 text-sm"
                  >
                    {dictionary.openStore}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void trackRouteClick(result)}
                    className="btn-primary px-4 py-2 text-sm font-medium"
                  >
                    {dictionary.routeAction}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}
