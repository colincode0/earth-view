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

const EONET_VOLCANOES_URL =
  "https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=100";
const TTL_MS = 30 * 60 * 1000;
const MARKER_RADIUS = 1.012;

type EonetGeometry = {
  date: string;
  magnitudeUnit?: string | null;
  magnitudeValue?: number | null;
  type: "Point" | "Polygon";
  coordinates: number[] | number[][][];
};

type EonetEvent = {
  closed: string | null;
  description: string | null;
  id: string;
  link: string;
  sources: { id: string; url: string }[];
  title: string;
  geometry: EonetGeometry[];
};

type EonetResponse = {
  events: EonetEvent[];
};

type Volcano = {
  id: string;
  lat: number;
  lon: number;
  recencyDate: string;
  detail: ActivityMarkerDetail;
};

type ProcessedVolcanoCache = {
  expiresAt: number;
  promise: Promise<Volcano[]>;
};

let processedVolcanoCache: ProcessedVolcanoCache | null = null;

function latestPointGeometry(geometries: EonetGeometry[]) {
  for (let index = geometries.length - 1; index >= 0; index -= 1) {
    const geometry = geometries[index];
    if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
      const [lon, lat] = geometry.coordinates as number[];
      if (typeof lat === "number" && typeof lon === "number") {
        return { ...geometry, lat, lon };
      }
    }
  }
  return null;
}

function processVolcanoFeed(feed: EonetResponse) {
  const next: Volcano[] = [];

  for (const event of feed.events) {
    const point = latestPointGeometry(event.geometry);
    if (!point) continue;
    const observedAt = formatEventDate(point.date, { dateOnly: true });
    const recency = formatEventAge(point.date);
    const source = event.sources[0];
    const rows: ActivityMarkerDetail["rows"] = [
      {
        label: "Location",
        value: `${formatCoordinate(point.lat, ["N", "S"])}, ${formatCoordinate(point.lon, ["E", "W"])}`,
      },
      { label: "Status", value: event.closed ? "Closed" : "Open" },
    ];

    if (point.magnitudeValue !== null && point.magnitudeValue !== undefined) {
      rows.push({
        label: "Magnitude",
        value: `${point.magnitudeValue}${point.magnitudeUnit ? ` ${point.magnitudeUnit}` : ""}`,
      });
    }

    if (event.closed) {
      const closedAt = formatEventDate(event.closed, { dateOnly: true });
      if (closedAt) {
        rows.push({ label: "Closed", value: closedAt });
      }
    }

    next.push({
      id: event.id,
      lat: point.lat,
      lon: point.lon,
      recencyDate: point.date,
      detail: {
        id: event.id,
        kind: "Volcano",
        title: event.title,
        subtitle: event.description ?? undefined,
        occurredAt: observedAt ? `Observed ${observedAt}` : undefined,
        recency: recency ?? undefined,
        sourceLabel: source?.id ?? "NASA EONET",
        sourceUrl: source?.url ?? event.link,
        rows,
      },
    });
  }

  return next;
}

function refreshVolcanoRecency(volcanoes: Volcano[]) {
  return volcanoes.map((volcano) => ({
    ...volcano,
    detail: {
      ...volcano.detail,
      recency: formatEventAge(volcano.recencyDate) ?? undefined,
    },
  }));
}

function fetchProcessedVolcanoes() {
  const now = Date.now();

  if (processedVolcanoCache && processedVolcanoCache.expiresAt > now) {
    return processedVolcanoCache.promise.then(refreshVolcanoRecency);
  }

  const promise = fetchJsonCached<EonetResponse>(EONET_VOLCANOES_URL, TTL_MS)
    .then(processVolcanoFeed)
    .catch((error: unknown) => {
      if (processedVolcanoCache?.promise === promise) {
        processedVolcanoCache = null;
      }

      throw error;
    });

  processedVolcanoCache = {
    promise,
    expiresAt: now + TTL_MS,
  };

  return promise.then(refreshVolcanoRecency);
}

export function VolcanoMarkers() {
  const [volcanoes, setVolcanoes] = useState<Volcano[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetchProcessedVolcanoes()
      .then((next) => {
        if (cancelled) return;
        setVolcanoes(next);
      })
      .catch(() => {
        if (!cancelled) setVolcanoes([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const markers = useMemo(
    () =>
      volcanoes.map((volcano) => {
        const position = latLonToVector(volcano.lat, volcano.lon, MARKER_RADIUS);
        return {
          id: volcano.id,
          detail: volcano.detail,
          position: [position.x, position.y, position.z] as [number, number, number],
        };
      }),
    [volcanoes],
  );

  return (
    <group>
      {markers.map((marker) => (
        <ActivityCrosshair
          key={marker.id}
          color="#ff6b35"
          detail={marker.detail}
          position={marker.position}
          variant="volcano"
        />
      ))}
    </group>
  );
}
