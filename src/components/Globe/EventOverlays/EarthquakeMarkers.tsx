import { useEffect, useMemo, useState } from "react";
import { latLonToVector } from "@/lib/geo";
import { ActivityCrosshair } from "./ActivityCrosshair";
import {
  formatCoordinate,
  formatEventAge,
  formatEventDate,
} from "./eventDetails";
import { fetchJsonCached } from "./eventFetch";
import type { ActivityMarkerDetail } from "./activityHoverStore";

const USGS_FEED_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
const TTL_MS = 5 * 60 * 1000;
const MARKER_RADIUS = 1.012;

type EarthquakeFeature = {
  id: string;
  properties: {
    alert: string | null;
    mag: number | null;
    magType: string | null;
    place: string | null;
    status: string | null;
    time: number;
    title: string | null;
    tsunami: number;
    type: string | null;
    updated: number | null;
    url: string | null;
  };
  geometry: { type: "Point"; coordinates: [number, number, number] };
};

type EarthquakeFeed = {
  features: EarthquakeFeature[];
};

type Quake = {
  id: string;
  lat: number;
  lon: number;
  magnitude: number;
  depthKm: number;
  recencyTime: number;
  detail: ActivityMarkerDetail;
};

type ProcessedQuakeCache = {
  expiresAt: number;
  promise: Promise<Quake[]>;
};

let processedQuakeCache: ProcessedQuakeCache | null = null;

function magnitudeToSizeMultiplier(magnitude: number) {
  return 0.85 + Math.max(0, Math.min(7, magnitude)) * 0.08;
}

function magnitudeToColor(magnitude: number) {
  if (magnitude >= 6) return "#ff2d55";
  if (magnitude >= 5) return "#ff9f0a";
  if (magnitude >= 4) return "#ffd60a";
  return "#34c759";
}

function processEarthquakeFeed(feed: EarthquakeFeed) {
  const next: Quake[] = [];

  for (const feature of feed.features) {
    const magnitude = feature.properties.mag;
    if (magnitude === null || magnitude < 2.5) continue;

    const [lon, lat, depthKm] = feature.geometry.coordinates;
    const occurredAt = formatEventDate(feature.properties.time);
    const recency = formatEventAge(feature.properties.time);
    const updatedAt = feature.properties.updated
      ? formatEventDate(feature.properties.updated)
      : null;
    const title =
      feature.properties.title ??
      `M ${magnitude.toFixed(1)} earthquake`;
    const rows: ActivityMarkerDetail["rows"] = [
      { label: "Magnitude", value: magnitude.toFixed(1) },
      { label: "Depth", value: `${depthKm.toFixed(1)} km` },
      {
        label: "Location",
        value: `${formatCoordinate(lat, ["N", "S"])}, ${formatCoordinate(lon, ["E", "W"])}`,
      },
    ];

    if (feature.properties.magType) {
      rows.push({ label: "Scale", value: feature.properties.magType.toUpperCase() });
    }

    if (feature.properties.alert) {
      rows.push({ label: "Alert", value: feature.properties.alert });
    }

    if (updatedAt) {
      rows.push({ label: "Updated", value: updatedAt });
    }

    if (feature.properties.status) {
      rows.push({ label: "Status", value: feature.properties.status });
    }

    if (feature.properties.tsunami) {
      rows.push({ label: "Tsunami", value: "Possible" });
    }

    next.push({
      id: feature.id,
      lat,
      lon,
      magnitude,
      depthKm,
      recencyTime: feature.properties.time,
      detail: {
        id: feature.id,
        kind: "Earthquake",
        title,
        subtitle: feature.properties.place ?? feature.properties.type ?? undefined,
        occurredAt: occurredAt ?? undefined,
        recency: recency ?? undefined,
        sourceLabel: "USGS",
        sourceUrl: feature.properties.url ?? undefined,
        rows,
      },
    });
  }

  return next;
}

function refreshQuakeRecency(quakes: Quake[]) {
  return quakes.map((quake) => ({
    ...quake,
    detail: {
      ...quake.detail,
      recency: formatEventAge(quake.recencyTime) ?? undefined,
    },
  }));
}

function fetchProcessedQuakes() {
  const now = Date.now();

  if (processedQuakeCache && processedQuakeCache.expiresAt > now) {
    return processedQuakeCache.promise.then(refreshQuakeRecency);
  }

  const promise = fetchJsonCached<EarthquakeFeed>(USGS_FEED_URL, TTL_MS)
    .then(processEarthquakeFeed)
    .catch((error: unknown) => {
      if (processedQuakeCache?.promise === promise) {
        processedQuakeCache = null;
      }

      throw error;
    });

  processedQuakeCache = {
    promise,
    expiresAt: now + TTL_MS,
  };

  return promise.then(refreshQuakeRecency);
}

export function EarthquakeMarkers() {
  const [quakes, setQuakes] = useState<Quake[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetchProcessedQuakes()
      .then((next) => {
        if (cancelled) return;
        setQuakes(next);
      })
      .catch(() => {
        if (!cancelled) setQuakes([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const markers = useMemo(
    () =>
      quakes.map((quake) => {
        const position = latLonToVector(quake.lat, quake.lon, MARKER_RADIUS);
        return {
          ...quake,
          position: [position.x, position.y, position.z] as [number, number, number],
          sizeMultiplier: magnitudeToSizeMultiplier(quake.magnitude),
          color: magnitudeToColor(quake.magnitude),
        };
      }),
    [quakes],
  );

  return (
    <group>
      {markers.map((marker) => (
        <ActivityCrosshair
          key={marker.id}
          color={marker.color}
          detail={marker.detail}
          position={marker.position}
          sizeMultiplier={marker.sizeMultiplier}
        />
      ))}
    </group>
  );
}
