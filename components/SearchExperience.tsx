"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LocalMap } from "@/components/LocalMap";
import type { Dictionary } from "@/lib/i18n";
import type { SearchResult } from "@/lib/types";

type SearchPayload = {
  query: string;
  origin: { lat: number; lng: number };
  radius: number;
  results: SearchResult[];
};

const LOCATION_CACHE_KEY = "kiezkauf:last-location";
const LOCATION_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

function triggerHaptic(pattern: number | number[] = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

function formatRadiusKm(radiusKm: number) {
  return Number.isInteger(radiusKm) ? `${radiusKm} km` : `${radiusKm.toFixed(1)} km`;
}

export function SearchExperience({
  dictionary,
  initialCenter
}: {
  dictionary: Dictionary;
  initialCenter: { lat: number; lng: number };
}) {
  const [query, setQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(2);
  const [center, setCenter] = useState(initialCenter);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const lastHapticAtRef = useRef(0);

  function pulse(pattern: number | number[] = 10) {
    const now = Date.now();
    if (now - lastHapticAtRef.current < 80) {
      return;
    }
    lastHapticAtRef.current = now;
    triggerHaptic(pattern);
  }

  useEffect(() => {
    try {
      const cached = localStorage.getItem(LOCATION_CACHE_KEY);
      if (!cached) {
        return;
      }

      const parsed = JSON.parse(cached) as { lat: number; lng: number; timestamp: number };
      if (
        typeof parsed?.lat !== "number" ||
        typeof parsed?.lng !== "number" ||
        typeof parsed?.timestamp !== "number"
      ) {
        return;
      }

      if (Date.now() - parsed.timestamp > LOCATION_CACHE_TTL_MS) {
        return;
      }

      setCenter({ lat: parsed.lat, lng: parsed.lng });
      setLocationMessage(dictionary.geolocationRemembered);
    } catch {
      // Ignore bad local cache and keep default center.
    }
  }, [dictionary.geolocationRemembered]);

  const resultSummary = useMemo(() => {
    if (isLoading) {
      return dictionary.searchingLabel;
    }
    if (!hasSearched) {
      return dictionary.mapEmptyState;
    }
    return `${results.length} ${dictionary.resultsCountLabel}`;
  }, [dictionary.mapEmptyState, dictionary.resultsCountLabel, dictionary.searchingLabel, hasSearched, isLoading, results.length]);

  async function runSearch() {
    if (!query.trim()) {
      setErrorMessage(dictionary.queryRequiredError);
      pulse(18);
      return;
    }

    pulse(8);
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
      setHasSearched(true);
      pulse([12, 28, 10]);
    } catch (error) {
      console.error(error);
      setErrorMessage(dictionary.searchRequestError);
      pulse(24);
    } finally {
      setIsLoading(false);
    }
  }

  function useBrowserLocation() {
    pulse(8);
    if (!navigator.geolocation) {
      setErrorMessage(dictionary.geolocationError);
      pulse(22);
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextCenter = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setCenter(nextCenter);
        setLocationMessage(dictionary.geolocationReady);
        setErrorMessage(null);
        setIsLocating(false);
        pulse([10, 22, 10]);

        try {
          localStorage.setItem(
            LOCATION_CACHE_KEY,
            JSON.stringify({
              ...nextCenter,
              timestamp: Date.now()
            })
          );
        } catch {
          // Ignore localStorage write errors.
        }
      },
      () => {
        setErrorMessage(dictionary.geolocationError);
        setIsLocating(false);
        pulse(26);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <section className="space-y-4">
      <section className="tool-block">
        <div className="tool-row hand-divider p-3 md:p-4">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="sr-only" htmlFor="search-query-input">
              {dictionary.searchPlaceholder}
            </label>
            <input
              id="search-query-input"
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
            <button
              type="button"
              onClick={runSearch}
              disabled={isLoading}
              className={`btn-primary min-w-[124px] md:min-w-[150px] disabled:cursor-not-allowed ${
                isLoading ? "is-loading-stroke" : ""
              }`}
              aria-busy={isLoading}
            >
              <span className="btn-label">{isLoading ? dictionary.searchingLabel : dictionary.searchButton}</span>
            </button>
            <button
              type="button"
              onClick={useBrowserLocation}
              disabled={isLocating}
              className="btn-icon disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={dictionary.useMyLocation}
              title={dictionary.useMyLocation}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
                <path
                  d="M12 3v3m0 12v3M3 12h3m12 0h3m-9-5a5 5 0 100 10 5 5 0 000-10z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="tool-row hand-divider px-3 pb-3 pt-2 md:px-4 md:pb-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label htmlFor="radius-km-slider" className="mono text-[0.74rem] text-neutral-700">
              {dictionary.radiusLabel}
            </label>
            <span className="mono text-[0.74rem] text-neutral-700">{formatRadiusKm(radiusKm)}</span>
          </div>
          <input
            id="radius-km-slider"
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={radiusKm}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isNaN(next)) {
                setRadiusKm(next);
              }
            }}
            onPointerUp={() => pulse(7)}
            onKeyUp={(event) => {
              if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "ArrowUp" ||
                event.key === "ArrowDown"
              ) {
                pulse(7);
              }
            }}
            className="range-input"
          />
        </div>

        {(locationMessage || errorMessage) && (
          <div className="p-3 md:p-4">
            {locationMessage ? <p className="status-text">{locationMessage}</p> : null}
            {errorMessage ? <p className="status-text text-neutral-800">{errorMessage}</p> : null}
          </div>
        )}
      </section>

      <section id="map" className="space-y-2">
        <div className="hand-divider flex items-end justify-between pb-2">
          <h2 className="text-[1.05rem] font-medium tracking-tight">{dictionary.mapTitle}</h2>
          <p className="status-text">{resultSummary}</p>
        </div>
        <LocalMap
          center={center}
          results={results}
          userMarkerLabel={dictionary.mapYouAreHere}
          matchedProductLabel={dictionary.matchedProductLabel}
          storeCategoryLabel={dictionary.storeCategoryLabel}
          distanceLabel={dictionary.distanceLabel}
          validationLabel={dictionary.validationLabel}
          validationLikelyLabel={dictionary.validationLikely}
          validationValidatedLabel={dictionary.validationValidated}
          unknownCategoryLabel={dictionary.unknownCategory}
          className="h-[58vh] min-h-[300px] border border-neutral-300 md:h-[66vh] md:min-h-[360px]"
        />

        {!isLoading && hasSearched && results.length === 0 ? (
          <p className="border border-neutral-300 p-3 text-sm text-neutral-600">{dictionary.noResults}</p>
        ) : null}
      </section>
    </section>
  );
}
