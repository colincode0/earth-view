import { useEffect, useMemo, useState } from "react";
import { latLonToVector } from "@/lib/geo";
import { fetchJsonCached } from "./eventFetch";

const EONET_VOLCANOES_URL =
  "https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=100";
const TTL_MS = 30 * 60 * 1000;
const MARKER_RADIUS = 1.012;
const MARKER_SIZE = 0.0085;

type EonetGeometry = {
  date: string;
  type: "Point" | "Polygon";
  coordinates: number[] | number[][][];
};

type EonetEvent = {
  id: string;
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
};

function latestPointGeometry(geometries: EonetGeometry[]) {
  for (let index = geometries.length - 1; index >= 0; index -= 1) {
    const geometry = geometries[index];
    if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
      const [lon, lat] = geometry.coordinates as number[];
      if (typeof lat === "number" && typeof lon === "number") {
        return { lat, lon };
      }
    }
  }
  return null;
}

export function VolcanoMarkers() {
  const [volcanoes, setVolcanoes] = useState<Volcano[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetchJsonCached<EonetResponse>(EONET_VOLCANOES_URL, TTL_MS)
      .then((feed) => {
        if (cancelled) return;

        const next: Volcano[] = [];
        for (const event of feed.events) {
          const point = latestPointGeometry(event.geometry);
          if (!point) continue;
          next.push({ id: event.id, lat: point.lat, lon: point.lon });
        }
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
          position: [position.x, position.y, position.z] as [number, number, number],
        };
      }),
    [volcanoes],
  );

  return (
    <group>
      {markers.map((marker) => (
        <mesh key={marker.id} position={marker.position}>
          <sphereGeometry args={[MARKER_SIZE, 12, 12]} />
          <meshBasicMaterial color="#ff6b35" transparent opacity={0.95} />
        </mesh>
      ))}
    </group>
  );
}
