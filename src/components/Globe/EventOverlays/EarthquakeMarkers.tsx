import { useEffect, useMemo, useState } from "react";
import { latLonToVector } from "@/lib/geo";
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

function magnitudeToScale(magnitude: number) {
  return 0.004 + Math.max(0, magnitude) * 0.0035;
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
          scale: magnitudeToScale(quake.magnitude),
          color: magnitudeToColor(quake.magnitude),
        };
      }),
    [quakes],
  );

  return (
    <group>
      {markers.map((marker) => (
        <mesh key={marker.id} position={marker.position}>
          <sphereGeometry args={[marker.scale, 12, 12]} />
          <meshBasicMaterial color={marker.color} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}
