import { useEffect, useMemo, useState } from "react";
import { latLonToVector } from "@/lib/geo";
import { ActivityCrosshair } from "./ActivityCrosshair";
import { fetchJsonCached } from "./eventFetch";

const USGS_FEED_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
const TTL_MS = 5 * 60 * 1000;
const MARKER_RADIUS = 1.012;

type EarthquakeFeature = {
  id: string;
  properties: { mag: number | null; place: string | null; time: number };
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
};

function magnitudeToSizeMultiplier(magnitude: number) {
  return 0.85 + Math.max(0, Math.min(7, magnitude)) * 0.08;
}

function magnitudeToColor(magnitude: number) {
  if (magnitude >= 6) return "#ff2d55";
  if (magnitude >= 5) return "#ff9f0a";
  if (magnitude >= 4) return "#ffd60a";
  return "#34c759";
}

export function EarthquakeMarkers() {
  const [quakes, setQuakes] = useState<Quake[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetchJsonCached<EarthquakeFeed>(USGS_FEED_URL, TTL_MS)
      .then((feed) => {
        if (cancelled) return;

        const next: Quake[] = [];
        for (const feature of feed.features) {
          const magnitude = feature.properties.mag;
          if (magnitude === null || magnitude < 2.5) continue;

          const [lon, lat] = feature.geometry.coordinates;
          next.push({ id: feature.id, lat, lon, magnitude });
        }
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
          position={marker.position}
          sizeMultiplier={marker.sizeMultiplier}
        />
      ))}
    </group>
  );
}
