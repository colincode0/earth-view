import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { latLonToVector } from "@/lib/geo";

export const WORLD_GEOJSON_URLS = [
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson",
  "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson",
] as const;

export const ADMIN_1_GEOJSON_URLS = [
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson",
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
] as const;

const geoJsonRequestCache = new Map<string, Promise<GeoJsonCollection>>();

export type Position = [number, number];

type LineStringGeometry = {
  type: "LineString";
  coordinates: Position[];
};

type MultiLineStringGeometry = {
  type: "MultiLineString";
  coordinates: Position[][];
};

type PolygonGeometry = {
  type: "Polygon";
  coordinates: Position[][];
};

type MultiPolygonGeometry = {
  type: "MultiPolygon";
  coordinates: Position[][][];
};

export type GeoJsonFeature = {
  geometry:
    | LineStringGeometry
    | MultiLineStringGeometry
    | PolygonGeometry
    | MultiPolygonGeometry
    | null;
};

export type GeoJsonCollection = {
  features: GeoJsonFeature[];
};

function positionsToSegments(positions: Position[], radius: number) {
  const vertices: number[] = [];

  for (let index = 0; index < positions.length - 1; index += 1) {
    const [lonA, latA] = positions[index];
    const [lonB, latB] = positions[index + 1];

    if (Math.abs(lonA - lonB) > 180) {
      continue;
    }

    const a = latLonToVector(latA, lonA, radius);
    const b = latLonToVector(latB, lonB, radius);
    vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  return vertices;
}

function buildGeometry(vertices: number[]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function geometryToVertices(geometry: NonNullable<GeoJsonFeature["geometry"]>, radius: number) {
  const vertices: number[] = [];

  if (geometry.type === "LineString") {
    vertices.push(...positionsToSegments(geometry.coordinates, radius));
  }

  if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) {
      vertices.push(...positionsToSegments(line, radius));
    }
  }

  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      vertices.push(...positionsToSegments(ring, radius));
    }
  }

  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        vertices.push(...positionsToSegments(ring, radius));
      }
    }
  }

  return vertices;
}

function buildBorderGeometry(collection: GeoJsonCollection, radius: number) {
  const vertices: number[] = [];

  for (const feature of collection.features) {
    if (!feature.geometry) {
      continue;
    }

    vertices.push(...geometryToVertices(feature.geometry, radius));
  }

  return buildGeometry(vertices);
}

function buildGraticuleGeometry() {
  const vertices: number[] = [];
  const radius = 1.002;

  for (let lon = -180; lon <= 180; lon += 15) {
    for (let lat = -75; lat < 75; lat += 3) {
      const a = latLonToVector(lat, lon, radius);
      const b = latLonToVector(lat + 3, lon, radius);
      vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  for (let lat = -75; lat <= 75; lat += 15) {
    for (let lon = -180; lon < 180; lon += 3) {
      const a = latLonToVector(lat, lon, radius);
      const b = latLonToVector(lat, lon + 3, radius);
      vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  return buildGeometry(vertices);
}

async function fetchGeoJsonUncached(urls: readonly string[]) {
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Unable to load boundary data from ${url}`);
      }

      return (await response.json()) as GeoJsonCollection;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export function fetchGeoJson(urls: readonly string[]) {
  const cacheKey = urls.join("|");
  const cached = geoJsonRequestCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const request = fetchGeoJsonUncached(urls).catch((error: unknown) => {
    geoJsonRequestCache.delete(cacheKey);
    throw error;
  });
  geoJsonRequestCache.set(cacheKey, request);

  return request;
}

export function BoundaryLines() {
  const [countryGeometry, setCountryGeometry] = useState<BufferGeometry | null>(null);
  const [admin1Geometry, setAdmin1Geometry] = useState<BufferGeometry | null>(null);
  const graticuleGeometry = useMemo(buildGraticuleGeometry, []);

  useEffect(() => {
    const controller = new AbortController();

    fetchGeoJson(WORLD_GEOJSON_URLS)
      .then((collection) => {
        if (!controller.signal.aborted) {
          setCountryGeometry(buildBorderGeometry(collection, 1.006));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCountryGeometry(null);
        }
      });

    fetchGeoJson(ADMIN_1_GEOJSON_URLS)
      .then((collection) => {
        if (!controller.signal.aborted) {
          setAdmin1Geometry(buildBorderGeometry(collection, 1.008));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAdmin1Geometry(null);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => () => graticuleGeometry.dispose(), [graticuleGeometry]);
  useEffect(() => () => countryGeometry?.dispose(), [countryGeometry]);
  useEffect(() => () => admin1Geometry?.dispose(), [admin1Geometry]);

  return (
    <group>
      <lineSegments geometry={graticuleGeometry}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.16} depthTest />
      </lineSegments>
      {admin1Geometry && (
        <lineSegments geometry={admin1Geometry}>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.38} depthTest />
        </lineSegments>
      )}
      {countryGeometry && (
        <lineSegments geometry={countryGeometry}>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.9} depthTest />
        </lineSegments>
      )}
    </group>
  );
}
