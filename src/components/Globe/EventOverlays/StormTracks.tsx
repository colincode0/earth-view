import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { latLonToVector } from "@/lib/geo";
import { ActivityCrosshair } from "./ActivityCrosshair";
import {
  formatCoordinate,
  formatEventAge,
  formatEventDate,
} from "./eventDetails";
import { fetchJsonCached } from "./eventFetch";
import type { ActivityMarkerDetail } from "./activityHoverStore";

const EONET_STORMS_URL =
  "https://eonet.gsfc.nasa.gov/api/v3/events?category=severeStorms&status=open&limit=50";
const TTL_MS = 15 * 60 * 1000;
const TRACK_RADIUS = 1.01;
const HEAD_RADIUS = 1.013;

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

type StormTrack = {
  id: string;
  detail: ActivityMarkerDetail;
  recencyDate?: string;
  points: { date: string; lat: number; lon: number; magnitudeUnit?: string | null; magnitudeValue?: number | null }[];
};

type ProcessedStormCache = {
  expiresAt: number;
  promise: Promise<StormTrack[]>;
};

let processedStormCache: ProcessedStormCache | null = null;

function extractPointTrack(geometries: EonetGeometry[]) {
  const points: StormTrack["points"] = [];
  for (const geometry of geometries) {
    if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) continue;
    const [lon, lat] = geometry.coordinates as number[];
    if (typeof lat === "number" && typeof lon === "number") {
      points.push({
        date: geometry.date,
        lat,
        lon,
        magnitudeUnit: geometry.magnitudeUnit,
        magnitudeValue: geometry.magnitudeValue,
      });
    }
  }
  return points;
}

function formatStormIntensity(point: StormTrack["points"][number]) {
  if (point.magnitudeValue === null || point.magnitudeValue === undefined) {
    return null;
  }

  return `${point.magnitudeValue}${point.magnitudeUnit ? ` ${point.magnitudeUnit}` : ""}`;
}

function buildStormDetail(event: EonetEvent, points: StormTrack["points"]): ActivityMarkerDetail {
  const firstPoint = points[0];
  const latestPoint = points[points.length - 1];
  const source = event.sources[0];
  const startedAt = firstPoint ? formatEventDate(firstPoint.date, { dateOnly: true }) : null;
  const latestAt = latestPoint ? formatEventDate(latestPoint.date) : null;
  const latestAge = latestPoint ? formatEventAge(latestPoint.date) : null;
  const latestIntensity = latestPoint ? formatStormIntensity(latestPoint) : null;
  const peakPoint = points.reduce<StormTrack["points"][number] | null>((peak, point) => {
    if (point.magnitudeValue === null || point.magnitudeValue === undefined) {
      return peak;
    }

    if (!peak || (peak.magnitudeValue ?? 0) < point.magnitudeValue) {
      return point;
    }

    return peak;
  }, null);
  const peakIntensity = peakPoint ? formatStormIntensity(peakPoint) : null;
  const rows: ActivityMarkerDetail["rows"] = [
    { label: "Track pts", value: points.length.toString() },
    { label: "Status", value: event.closed ? "Closed" : "Open" },
  ];

  if (latestPoint) {
    rows.push({
      label: "Latest loc",
      value: `${formatCoordinate(latestPoint.lat, ["N", "S"])}, ${formatCoordinate(latestPoint.lon, ["E", "W"])}`,
    });
  }

  if (startedAt) {
    rows.push({ label: "Started", value: startedAt });
  }

  if (latestIntensity) {
    rows.push({ label: "Latest", value: latestIntensity });
  }

  if (peakIntensity) {
    rows.push({ label: "Peak", value: peakIntensity });
  }

  if (event.closed) {
    const closedAt = formatEventDate(event.closed, { dateOnly: true });
    if (closedAt) {
      rows.push({ label: "Closed", value: closedAt });
    }
  }

  return {
    id: event.id,
    kind: "Storm",
    title: event.title,
    subtitle: event.description ?? undefined,
    occurredAt: latestAt ? `Latest fix ${latestAt}` : undefined,
    recency: latestAge ?? undefined,
    sourceLabel: source?.id ?? "NASA EONET",
    sourceUrl: source?.url ?? event.link,
    rows,
  };
}

function processStormFeed(feed: EonetResponse) {
  const next: StormTrack[] = [];

  for (const event of feed.events) {
    const points = extractPointTrack(event.geometry);
    if (points.length === 0) continue;
    next.push({
      id: event.id,
      detail: buildStormDetail(event, points),
      recencyDate: points[points.length - 1]?.date,
      points,
    });
  }

  return next;
}

function refreshStormRecency(tracks: StormTrack[]) {
  return tracks.map((track) => ({
    ...track,
    detail: {
      ...track.detail,
      recency: track.recencyDate ? formatEventAge(track.recencyDate) ?? undefined : undefined,
    },
  }));
}

function fetchProcessedStorms() {
  const now = Date.now();

  if (processedStormCache && processedStormCache.expiresAt > now) {
    return processedStormCache.promise.then(refreshStormRecency);
  }

  const promise = fetchJsonCached<EonetResponse>(EONET_STORMS_URL, TTL_MS)
    .then(processStormFeed)
    .catch((error: unknown) => {
      if (processedStormCache?.promise === promise) {
        processedStormCache = null;
      }

      throw error;
    });

  processedStormCache = {
    promise,
    expiresAt: now + TTL_MS,
  };

  return promise.then(refreshStormRecency);
}

function buildTrackGeometry(tracks: StormTrack[]) {
  const vertices: number[] = [];

  for (const track of tracks) {
    for (let index = 0; index < track.points.length - 1; index += 1) {
      const a = track.points[index];
      const b = track.points[index + 1];
      if (Math.abs(a.lon - b.lon) > 180) continue;

      const va = latLonToVector(a.lat, a.lon, TRACK_RADIUS);
      const vb = latLonToVector(b.lat, b.lon, TRACK_RADIUS);
      vertices.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function StormTracks() {
  const [tracks, setTracks] = useState<StormTrack[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetchProcessedStorms()
      .then((next) => {
        if (cancelled) return;
        setTracks(next);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const lineGeometry = useMemo(() => buildTrackGeometry(tracks), [tracks]);

  useEffect(() => () => lineGeometry.dispose(), [lineGeometry]);

  const heads = useMemo(
    () =>
      tracks
        .map((track) => {
          const last = track.points[track.points.length - 1];
          if (!last) return null;
          const position = latLonToVector(last.lat, last.lon, HEAD_RADIUS);
          return {
            id: track.id,
            detail: track.detail,
            position: [position.x, position.y, position.z] as [number, number, number],
          };
        })
        .filter((head): head is NonNullable<typeof head> => head !== null),
    [tracks],
  );

  return (
    <group>
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial color="#5ac8fa" transparent opacity={0.85} />
      </lineSegments>
      {heads.map((head) => (
        <ActivityCrosshair
          key={head.id}
          color="#5ac8fa"
          detail={head.detail}
          position={head.position}
        />
      ))}
    </group>
  );
}
