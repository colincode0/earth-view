import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { latLonToVector } from "@/lib/geo";
import { fetchJsonCached } from "./eventFetch";

const EONET_STORMS_URL =
  "https://eonet.gsfc.nasa.gov/api/v3/events?category=severeStorms&status=open&limit=50";
const TTL_MS = 15 * 60 * 1000;
const TRACK_RADIUS = 1.01;
const HEAD_RADIUS = 1.013;
const HEAD_SIZE = 0.009;

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

type StormTrack = {
  id: string;
  points: { lat: number; lon: number }[];
};

function extractPointTrack(geometries: EonetGeometry[]) {
  const points: { lat: number; lon: number }[] = [];
  for (const geometry of geometries) {
    if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) continue;
    const [lon, lat] = geometry.coordinates as number[];
    if (typeof lat === "number" && typeof lon === "number") {
      points.push({ lat, lon });
    }
  }
  return points;
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

    fetchJsonCached<EonetResponse>(EONET_STORMS_URL, TTL_MS)
      .then((feed) => {
        if (cancelled) return;

        const next: StormTrack[] = [];
        for (const event of feed.events) {
          const points = extractPointTrack(event.geometry);
          if (points.length === 0) continue;
          next.push({ id: event.id, points });
        }
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
        <mesh key={head.id} position={head.position}>
          <sphereGeometry args={[HEAD_SIZE, 12, 12]} />
          <meshBasicMaterial color="#5ac8fa" transparent opacity={0.95} />
        </mesh>
      ))}
    </group>
  );
}
